// =============================================================================
// Deploy
// The 5 contracts sit behind TransparentUpgradeableProxy with the team upgrade key
// as the admin.
// =============================================================================

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { ethers } = require("ethers");

const E = ethers.parseEther;
const BLOCK_GAS_LIMIT = 30_000_000n;
const STATE_SCHEMA_VERSION = 2;

const PROPOSER_ROLE = ethers.id("PROPOSER_ROLE");
const EXECUTOR_ROLE = ethers.id("EXECUTOR_ROLE");
const TIMELOCK_ADMIN_ROLE = ethers.id("TIMELOCK_ADMIN_ROLE");

const usedPorts = new Set();
const spawnedAnvils = new Set();

const ARTIFACT_FOR = {
  gov: "Token",
  treasuryAsset: "Token",
  collateral: "Token",
  debt: "Token",
  lp: "Token",
  reward: "Token",
  marketAsset: "Token",
  stable: "Token",
  mirror: "VoteMirror",
  vault: "GovStakingVault",
  treasury: "Treasury",
  timelock: "DaoTimelock",
  governor: "RiskGovernor",
  oracle: "OracleHub",
  lending: "LendingVault",
  rewardStaking: "RewardStaking",
  rewardGaugeV1: "RewardGaugeV1",
  rewardGaugeV2: "RewardGaugeV2",
  amm: "ConstantProductAMM",
  registry: "ProtocolRegistry",
};

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

function deriveReferenceBorrower(mnemonic, chainId) {
  const hash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["string", "uint256"],
      [mnemonic, chainId]
    )
  );
  return ethers.getAddress(`0x${hash.slice(26)}`);
}

function anvilReady(url) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] });
    const target = new URL(url);
    const req = http.request(
      {
        host: target.hostname,
        port: target.port,
        method: "POST",
        path: "/",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
        timeout: 500,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try { resolve(typeof JSON.parse(data).result === "string"); }
          catch { resolve(false); }
        });
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.end(body);
  });
}

async function waitForAnvil(url, child) {
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null) throw new Error(`anvil exited early (code ${child.exitCode})`);
    if (await anvilReady(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("anvil failed to become ready");
}

async function startAnvil(chainId, mnemonic, opts = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = opts.port ?? allocatePort();
    const host = opts.host ?? "127.0.0.1";
    const args = [
      "--port", String(port),
      "--host", host,
      "--chain-id", String(chainId),
      "--mnemonic", mnemonic,
      "--accounts", "2",
      "--hardfork", "shanghai",
    ];
    if (opts.stateFile) {
      args.push("--state", opts.stateFile);
      args.push("--state-interval", String(opts.stateInterval ?? 10));
    }
    const child = spawn("anvil", args, { stdio: "ignore" });
    child.unref();
    spawnedAnvils.add(child);
    const url = `http://127.0.0.1:${port}`;
    try {
      await waitForAnvil(url, child);
      const provider = new ethers.JsonRpcProvider(url);
      const stop = () => {
        try { child.kill("SIGINT"); } catch { }
        usedPorts.delete(port);
        spawnedAnvils.delete(child);
      };
      return { provider, stop, port };
    } catch (error) {
      lastError = error;
      try { child.kill(); } catch { }
      usedPorts.delete(port);
      spawnedAnvils.delete(child);
    }
  }
  throw lastError;
}

// ----------------------------------------------------------------------------
// Deploy the full system.
// ----------------------------------------------------------------------------

async function deploySystem(artifacts, opts = {}) {
  const chainId = opts.chainId ?? 31337;
  const mnemonic = opts.mnemonic ?? randomMnemonic();
  const stateFile = opts.stateFile;
  const metaFile = stateFile ? `${stateFile}.meta.json` : null;

  const { provider, stop, port } = await startAnvil(chainId, mnemonic, {
    stateFile,
    host: opts.host,
    port: opts.port,
  });
  const eip1193 = { request: ({ method, params = [] }) => provider.send(method, params) };

  const deployer = ethers.Wallet.fromPhrase(mnemonic).connect(provider);
  const playerWallet = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0/1");
  const upgradeWallet = opts.upgradeKey
    ? new ethers.Wallet(opts.upgradeKey)
    : ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0/2");
  const { chainId: cid } = await provider.getNetwork();

  const sendTransaction = async (to, data, value = 0n) => {
    if (await provider.getBalance(deployer.address) < E("100")) {
      await provider.send("anvil_setBalance", [deployer.address, ethers.toQuantity(E("10000"))]);
    }
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

  let transactionQueue = Promise.resolve();
  const send = (to, data, value = 0n) => {
    const task = transactionQueue.then(() => sendTransaction(to, data, value));
    transactionQueue = task.catch(() => undefined);
    return task;
  };

  const deploy = async (artifact, args = []) => {
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode);
    const tx = await factory.getDeployTransaction(...args);
    const receipt = await send(null, tx.data);
    return new ethers.Contract(receipt.contractAddress, artifact.abi);
  };

  const act = async (contract, method, args = []) =>
    send(await contract.getAddress(), contract.interface.encodeFunctionData(method, args));

  const setBalance = async (token, to, target) => {
    const data = token.interface.encodeFunctionData("balanceOf", [to]);
    const current = BigInt(await provider.send("eth_call", [{ to: await token.getAddress(), data }, "latest"]));
    if (current > target) await act(token, "burn", [to, current - target]);
    else if (current < target) await act(token, "mint", [to, target - current]);
  };

  const deployProxy = async (artifact, initArgs = []) => {
    const impl = await deploy(artifact);
    const initData = new ethers.Interface(artifact.abi).encodeFunctionData("initialize", initArgs);
    const proxy = await deploy(artifacts.TransparentUpgradeableProxy, [await impl.getAddress(), upgradeWallet.address, initData]);
    return new ethers.Contract(await proxy.getAddress(), artifact.abi);
  };

  let meta = null;
  if (metaFile) {
    try {
      const parsed = JSON.parse(fs.readFileSync(metaFile, "utf8"));
      if (
        parsed.schemaVersion === STATE_SCHEMA_VERSION &&
        parsed.chainId === Number(cid) &&
        parsed.mnemonic === mnemonic &&
        parsed.addresses
      ) {
        meta = parsed;
      }
    } catch { }
  }

  let contracts;
  let referenceBorrower;
  let addresses;

  if (meta) {
    contracts = {};
    for (const [name, artifactName] of Object.entries(ARTIFACT_FOR)) {
      const addr = meta.addresses[name];
      if (!addr && name === "registry") continue;
      if (!addr) throw new Error(`resume metadata missing address for "${name}"`);
      contracts[name] = new ethers.Contract(addr, artifacts[artifactName].abi);
    }
    referenceBorrower = meta.referenceBorrower;
    addresses = { ...meta.addresses };
  } else {
    const token = async (name, symbol) => deploy(artifacts.Token, [name, symbol]);
    const gov = await token("DAO Governance", "GOV");
    const treasuryAsset = await token("Treasury Asset", "TRES");
    const collateral = await token("Collateral Asset", "COLL");
    const debt = await token("Debt Asset", "DEBT");
    const lp = await token("Gauge LP", "DLP");
    const reward = await token("DAO Reward", "RWD");
    const marketAsset = await token("Market Asset", "MKT");
    const stable = await token("Settlement USD", "dUSD");

    const mirror = await deployProxy(artifacts.VoteMirror, []);
    const treasury = await deployProxy(artifacts.Treasury, []);
    const timelock = await deploy(artifacts.DaoTimelock, [deployer.address, await treasury.getAddress(), await treasuryAsset.getAddress()]);
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
    const rewardGaugeV1 = await deployProxy(artifacts.RewardGaugeV1, [await rewardStaking.getAddress(), await reward.getAddress()]);
    const rewardGaugeV2 = await deploy(artifacts.RewardGaugeV2, [await rewardStaking.getAddress()]);
    await act(rewardStaking, "configureMigration", [await rewardGaugeV1.getAddress(), await rewardGaugeV2.getAddress()]);
    await act(reward, "configureRewards", [await rewardGaugeV1.getAddress(), await rewardStaking.getAddress()]);

    const amm = await deploy(artifacts.ConstantProductAMM, [await marketAsset.getAddress(), await stable.getAddress()]);
    await act(marketAsset, "mint", [deployer.address, E("1000")]);
    await act(stable, "mint", [deployer.address, E("1000")]);
    await act(marketAsset, "approve", [await amm.getAddress(), E("1000")]);
    await act(stable, "approve", [await amm.getAddress(), E("1000")]);
    await act(amm, "addLiquidity", [E("1000"), E("1000")]);
    await act(amm, "setTreasury", [await treasury.getAddress()]);
    await act(treasury, "configureRebalance", [await amm.getAddress(), await marketAsset.getAddress(), await stable.getAddress()]);

    referenceBorrower = deriveReferenceBorrower(mnemonic, chainId);
    await act(treasuryAsset, "mint", [await treasury.getAddress(), E("10000")]);
    await act(marketAsset, "mint", [await treasury.getAddress(), E("1000")]);
    await act(collateral, "mint", [await lending.getAddress(), E("100")]);
    await act(lending, "seed", [referenceBorrower, E("100"), E("80")]);
    await act(reward, "mint", [await rewardGaugeV1.getAddress(), E("2000")]);
    const block = await provider.getBlock("latest");
    const ts = Number(block.timestamp);
    await act(oracle, "setReport", [await collateral.getAddress(), 1, E("2"), ts]);
    await act(oracle, "setReport", [await debt.getAddress(), 1, E("2"), ts]);
    await act(oracle, "setReport", [await collateral.getAddress(), 2, E("1"), ts]);
    await act(oracle, "setReport", [await debt.getAddress(), 2, E("1"), ts]);

    contracts = {
      gov, treasuryAsset, collateral, debt, lp, reward, marketAsset, stable,
      mirror, vault, treasury, timelock, governor, oracle, lending, rewardStaking,
      rewardGaugeV1, rewardGaugeV2, amm,
    };
    addresses = {};
    for (const [name, c] of Object.entries(contracts)) addresses[name] = await c.getAddress();

    const registry = await deploy(artifacts.ProtocolRegistry, [
      referenceBorrower, addresses.lending, addresses.rewardGaugeV1, addresses.governor,
      addresses.mirror, addresses.treasury,
    ]);
    contracts.registry = registry;
    addresses.registry = await registry.getAddress();

    await send(upgradeWallet.address, "0x", E("20"));

    if (metaFile) {
      fs.mkdirSync(path.dirname(metaFile), { recursive: true });
      fs.writeFileSync(
        metaFile,
        JSON.stringify({ schemaVersion: STATE_SCHEMA_VERSION, chainId: Number(cid), mnemonic, referenceBorrower, addresses }, null, 2)
      );
    }
  }

  if (!contracts.registry) {
    const registry = await deploy(artifacts.ProtocolRegistry, [
      referenceBorrower, addresses.lending, addresses.rewardGaugeV1, addresses.governor,
      addresses.mirror, addresses.treasury,
    ]);
    contracts.registry = registry;
    addresses.registry = await registry.getAddress();
    if (metaFile) {
      fs.writeFileSync(
        metaFile,
        JSON.stringify({ schemaVersion: STATE_SCHEMA_VERSION, chainId: Number(cid), mnemonic, referenceBorrower, addresses }, null, 2)
      );
    }
  }

  const funding = new Set();
  const fund = async (address) => {
    address = ethers.getAddress(address);
    if (funding.has(address)) return false;
    const issued = await Promise.all(["gov", "debt", "lp", "marketAsset"].map(async (name) => {
      const c = contracts[name];
      return new ethers.Contract(await c.getAddress(), c.interface, provider).grantIssued(address);
    }));
    if (issued.every(Boolean)) return false;
    funding.add(address);
    try {
      await provider.send("anvil_setBalance", [address, ethers.toQuantity(E("20"))]);
      await act(contracts.gov, "grant", [address, E("150")]);
      await act(contracts.debt, "grant", [address, E("80")]);
      await act(contracts.lp, "grant", [address, E("100")]);
      await act(contracts.marketAsset, "grant", [address, E("200")]);
      return true;
    } finally {
      funding.delete(address);
    }
  };

  const provisionPlayer = async () => {
    await provider.send("anvil_setBalance", [playerWallet.address, ethers.toQuantity(E("20"))]);
    await fund(playerWallet.address);
  };

  await fund(playerWallet.address);

  const refreshOracle = async () => act(contracts.oracle, "refresh", [addresses.collateral, addresses.debt]);
  await refreshOracle();

  const reset = async () => {
    await setBalance(contracts.treasuryAsset, await contracts.treasury.getAddress(), E("10000"));
    await setBalance(contracts.marketAsset, await contracts.treasury.getAddress(), E("1000"));
    await setBalance(contracts.stable, await contracts.treasury.getAddress(), E("0"));
    await setBalance(contracts.collateral, await contracts.lending.getAddress(), E("100"));
    await setBalance(contracts.debt, await contracts.lending.getAddress(), E("0"));
    await act(contracts.lending, "seed", [referenceBorrower, E("100"), E("80")]);

    const block = await provider.getBlock("latest");
    const ts = Number(block.timestamp);
    await act(contracts.oracle, "setReport", [await contracts.collateral.getAddress(), 1, E("2"), ts]);
    await act(contracts.oracle, "setReport", [await contracts.debt.getAddress(), 1, E("2"), ts]);
    await act(contracts.oracle, "setReport", [await contracts.collateral.getAddress(), 2, E("1"), ts]);
    await act(contracts.oracle, "setReport", [await contracts.debt.getAddress(), 2, E("1"), ts]);

    await act(contracts.rewardStaking, "resetMigration", []);
    await setBalance(contracts.reward, await contracts.rewardGaugeV1.getAddress(), E("2000"));
    await act(contracts.mirror, "resetDiagnostics", []);
    await act(contracts.treasury, "resetRebalanceState", []);

    await setBalance(contracts.marketAsset, await contracts.amm.getAddress(), E("1000"));
    await setBalance(contracts.stable, await contracts.amm.getAddress(), E("1000"));
    await act(contracts.amm, "syncReserves", []);
    await act(contracts.amm, "resetReference", []);
    await provisionPlayer();
  };

  return {
    playerAddress: playerWallet.address,
    playerPrivateKey: playerWallet.privateKey,
    upgradeAddress: upgradeWallet.address,
    upgradePrivateKey: upgradeWallet.privateKey,
    port,
    provider,
    eip1193,
    reset,
    fund,
    refreshOracle,
    stop,
    _addresses: { ...addresses, referenceBorrower }
  };
}

process.on("exit", () => {
  for (const child of spawnedAnvils) {
    try { child.kill(); } catch { }
  }
});

module.exports = { deploySystem };
