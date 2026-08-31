const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { ethers } = require("ethers");

const E = ethers.parseEther;
const BLOCK_GAS_LIMIT = 30_000_000n;

const PROPOSER_ROLE = ethers.id("PROPOSER_ROLE");
const EXECUTOR_ROLE = ethers.id("EXECUTOR_ROLE");
const TIMELOCK_ADMIN_ROLE = ethers.id("TIMELOCK_ADMIN_ROLE");

const usedPorts = new Set();
const spawnedAnvils = new Set();

function randomMnemonic() {
  return ethers.Mnemonic.entropyToPhrase(crypto.randomBytes(16));
}

function allocatePort() {
  for (let i = 0; i < 100; i++) {
    const port = 20000 + crypto.randomInt(30000);
    if (!usedPorts.has(port)) {
      usedPorts.add(port);
      return port;
    }
  }
  throw new Error("no free port for anvil");
}

async function waitForAnvil(provider, child) {
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null) throw new Error(`anvil exited early (code ${child.exitCode})`);
    try {
      await provider.getBlockNumber();
      return;
    } catch {
      /* still starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("anvil failed to become ready");
}

// Spawn an isolated anvil node with a per-team mnemonic. Accounts 0 (deployer)
// and 1 (team upgrade key) are both funded.
async function startAnvil(chainId, mnemonic) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = allocatePort();
    const child = spawn(
      "anvil",
      [
        "--port", String(port),
        "--chain-id", String(chainId),
        "--mnemonic", mnemonic,
        "--accounts", "2",
        "--hardfork", "shanghai",
      ],
      { stdio: "ignore" },
    );
    child.unref();
    spawnedAnvils.add(child);
    const provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${port}`);
    try {
      await waitForAnvil(provider, child);
      const stop = () => {
        try { child.kill(); } catch { /* already dead */ }
        usedPorts.delete(port);
        spawnedAnvils.delete(child);
      };
      return { provider, stop };
    } catch (error) {
      lastError = error;
      try { child.kill(); } catch { /* already dead */ }
      usedPorts.delete(port);
      spawnedAnvils.delete(child);
    }
  }
  throw lastError;
}

// Deploy the full DAO system behind transparent proxies on a persistent anvil.
// The 5 patchable contracts (VoteMirror, Treasury, RiskGovernor, LendingVault,
// LegacyGauge) are behind TransparentUpgradeableProxy + ProxyAdmin. The team
// upgrade credential (account 1) owns the ProxyAdmins.
async function deploySystem(artifacts, opts = {}) {
  const chainId = opts.chainId ?? 31337;
  const mnemonic = opts.mnemonic ?? randomMnemonic();
  const { provider, stop } = await startAnvil(chainId, mnemonic);
  const eip1193 = { request: ({ method, params = [] }) => provider.send(method, params) };

  const deployer = ethers.Wallet.fromPhrase(mnemonic).connect(provider);
  // Team-owned upgrade authority. In a GZCTF deployment the team's private key
  // is injected via GZCTF_UPGRADE_KEY and surfaced privately; for local dev it
  // falls back to account 1 of the (random) mnemonic.
  const upgradeWallet = opts.upgradeKey
    ? new ethers.Wallet(opts.upgradeKey)
    : ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0/1");
  const { chainId: cid } = await provider.getNetwork();

  const send = async (to, data, value = 0n) => {
    const nonce = BigInt(await provider.send("eth_getTransactionCount", [deployer.address, "pending"]));
    const gasPrice = BigInt(await provider.send("eth_gasPrice", []));
    const raw = await deployer.signTransaction({ type: 0, chainId: cid, nonce, gasLimit: BLOCK_GAS_LIMIT, gasPrice, to, data, value });
    const txHash = await provider.send("eth_sendRawTransaction", [raw]);
    let receipt = null;
    for (let i = 0; i < 200 && !receipt; i++) {
      receipt = await provider.getTransactionReceipt(txHash);
      if (!receipt) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!receipt) throw new Error(`tx not mined: ${txHash}`);
    if (BigInt(receipt.status) !== 1n) throw new Error(`tx reverted: ${txHash}`);
    return receipt;
  };

  // Fund the team's upgrade wallet so it can pay gas to deploy V2 + call
  // upgradeTo. (Anvil only funds mnemonic accounts 0/1; a GZCTF_UPGRADE_KEY is
  // an independent key and would otherwise have no ETH.)
  await send(upgradeWallet.address, "0x", E("20"));

  const deploy = async (artifact, args = []) => {
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode);
    const tx = await factory.getDeployTransaction(...args);
    const receipt = await send(null, tx.data);
    return new ethers.Contract(receipt.contractAddress, artifact.abi);
  };
  const act = async (contract, method, args = []) =>
    send(await contract.getAddress(), contract.interface.encodeFunctionData(method, args));
  // Deploy an implementation + transparent proxy, initialize, and return a
  // Contract bound to the proxy address but carrying the implementation ABI.
  const deployProxy = async (artifact, initArgs = []) => {
    const impl = await deploy(artifact);
    const initData = new ethers.Interface(artifact.abi).encodeFunctionData("initialize", initArgs);
    const proxy = await deploy(artifacts.TransparentUpgradeableProxy, [await impl.getAddress(), upgradeWallet.address, initData]);
    return new ethers.Contract(await proxy.getAddress(), artifact.abi);
  };

  // Tokens (immutable).
  const token = async (name, symbol) => deploy(artifacts.Token, [name, symbol]);
  const gov = await token("DAO Governance", "GOV");
  const treasuryAsset = await token("Treasury Asset", "TRES");
  const collateral = await token("Collateral Asset", "COLL");
  const debt = await token("Debt Asset", "DEBT");
  const lp = await token("Gauge LP", "DLP");
  const reward = await token("DAO Reward", "RWD");
  const marketAsset = await token("Market Asset", "MKT");
  const stable = await token("Settlement USD", "dUSD");

  // Proxied patchable contracts.
  const mirror = await deployProxy(artifacts.VoteMirror, []);
  const treasury = await deployProxy(artifacts.Treasury, []);
  const timelock = await deploy(artifacts.TimelockController, [0, [], [], deployer.address]);
  const governor = await deployProxy(artifacts.RiskGovernor, [
    await mirror.getAddress(), await timelock.getAddress(), await treasury.getAddress(), await treasuryAsset.getAddress(), E("500"),
  ]);
  await act(timelock, "grantRole", [PROPOSER_ROLE, await governor.getAddress()]);
  await act(timelock, "grantRole", [EXECUTOR_ROLE, ethers.ZeroAddress]);
  await act(treasury, "setGovernor", [await timelock.getAddress()]);
  await act(timelock, "renounceRole", [TIMELOCK_ADMIN_ROLE, deployer.address]);

  const vault = await deploy(artifacts.GovStakingVault, [await gov.getAddress(), await mirror.getAddress()]);
  await act(mirror, "setVault", [await vault.getAddress()]);

  const oracle = await deploy(artifacts.OracleHub);
  const lending = await deployProxy(artifacts.LendingVault, [
    await collateral.getAddress(), await debt.getAddress(), await oracle.getAddress(),
  ]);

  const rewardStaking = await deploy(artifacts.RewardStaking, [await lp.getAddress()]);
  const legacyGauge = await deployProxy(artifacts.LegacyGauge, [await rewardStaking.getAddress(), await reward.getAddress()]);
  const currentGauge = await deploy(artifacts.CurrentGauge, [await rewardStaking.getAddress()]);
  await act(rewardStaking, "configureMigration", [await legacyGauge.getAddress(), await currentGauge.getAddress()]);

  let amm = await deploy(artifacts.ConstantProductAMM, [await marketAsset.getAddress(), await stable.getAddress()]);
  await act(marketAsset, "mint", [deployer.address, E("1000")]);
  await act(stable, "mint", [deployer.address, E("1000")]);
  await act(marketAsset, "approve", [await amm.getAddress(), E("1000")]);
  await act(stable, "approve", [await amm.getAddress(), E("1000")]);
  await act(amm, "addLiquidity", [E("1000"), E("1000")]);
  await act(treasury, "configureRebalance", [await amm.getAddress(), await marketAsset.getAddress(), await stable.getAddress()]);

  // Seed the exploitable economic state.
  const victim = ethers.getAddress(`0x${crypto.randomBytes(20).toString("hex")}`);
  await act(treasuryAsset, "mint", [await treasury.getAddress(), E("10000")]);
  await act(marketAsset, "mint", [await treasury.getAddress(), E("1000")]);
  await act(collateral, "mint", [await lending.getAddress(), E("100")]);
  await act(lending, "seed", [victim, E("100"), E("80")]);
  await act(reward, "mint", [await legacyGauge.getAddress(), E("2000")]);
  const block = await provider.getBlock("latest");
  const ts = Number(block.timestamp);
  await act(oracle, "setReport", [await collateral.getAddress(), 1, E("2"), ts]);
  await act(oracle, "setReport", [await debt.getAddress(), 1, E("2"), ts]);
  await act(oracle, "setReport", [await collateral.getAddress(), 2, E("1"), ts]);
  await act(oracle, "setReport", [await debt.getAddress(), 2, E("1"), ts]);

  const contracts = {
    gov, treasuryAsset, collateral, debt, lp, reward, marketAsset, stable,
    mirror, vault, treasury, timelock, governor, oracle, lending, rewardStaking,
    legacyGauge, currentGauge, amm,
  };
  const addresses = {};
  const refresh = async () => {
    for (const [name, c] of Object.entries(contracts)) addresses[name] = await c.getAddress();
  };
  await refresh();

  // Faucet: one-time funding per attacker address (gas + exploit tokens).
  const funded = new Set();
  const fund = async (address) => {
    if (funded.has(address)) return false;
    funded.add(address);
    await send(address, "0x", E("20"));
    await act(gov, "mint", [address, E("150")]);
    await act(debt, "mint", [address, E("80")]);
    await act(lp, "mint", [address, E("100")]);
    await act(marketAsset, "mint", [address, E("200")]);
    return true;
  };

  // Per-round reset: re-seed the exploitable state (code/proxies persist).
  const reset = async () => {
    await act(treasuryAsset, "mint", [await treasury.getAddress(), E("10000")]);
    await act(marketAsset, "mint", [await treasury.getAddress(), E("1000")]);
    await act(collateral, "mint", [await lending.getAddress(), E("100")]);
    await act(lending, "seed", [victim, E("100"), E("80")]);
    await act(rewardStaking, "resetMigration", []);
    await act(reward, "mint", [await legacyGauge.getAddress(), E("2000")]);
    // Re-deploy the AMM (not proxied) + re-fund + re-point the treasury.
    amm = await deploy(artifacts.ConstantProductAMM, [await marketAsset.getAddress(), await stable.getAddress()]);
    await act(marketAsset, "mint", [deployer.address, E("1000")]);
    await act(stable, "mint", [deployer.address, E("1000")]);
    await act(marketAsset, "approve", [await amm.getAddress(), E("1000")]);
    await act(stable, "approve", [await amm.getAddress(), E("1000")]);
    await act(amm, "addLiquidity", [E("1000"), E("1000")]);
    await act(treasury, "configureRebalance", [await amm.getAddress(), await marketAsset.getAddress(), await stable.getAddress()]);
    contracts.amm = amm;
    addresses.amm = await amm.getAddress();
  };

  return {
    eip1193, provider, contracts, victim, stop, fund, reset,
    resetFunding: () => funded.clear(),
    deployer: deployer.address,
    upgradeAddress: upgradeWallet.address,
    upgradeKey: upgradeWallet.privateKey,
    mnemonic,
    chainId: Number(cid),
    _addresses: addresses,
    _refresh: refresh,
  };
}

// Backward-compatible helper used by tests: deploy + fund one player.
async function createChain(artifacts, player, chainId) {
  const sys = await deploySystem(artifacts, { chainId });
  await sys.fund(player);
  return {
    eip1193: sys.eip1193,
    provider: sys.provider,
    contracts: sys._addresses,
    victim: sys.victim,
    stop: sys.stop,
    fund: sys.fund,
    reset: sys.reset,
    system: sys,
  };
}

process.on("exit", () => {
  for (const child of spawnedAnvils) {
    try { child.kill(); } catch { /* already dead */ }
  }
});

module.exports = { createChain, deploySystem };
