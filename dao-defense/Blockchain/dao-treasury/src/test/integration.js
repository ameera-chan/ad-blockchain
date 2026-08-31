const assert = require("node:assert/strict");
const { ethers } = require("ethers");
const { compileContracts } = require("../lib/compiler");
const { createChain } = require("../scripts/deploy");

const E = ethers.parseEther;

// Legitimacy (functionality) flow for the default vulnerable build. Mirrors the
// service's own checks and the checker's walk, exercising the full
// propose -> vote -> queue -> execute lifecycle, EOA and contract delegation,
// observer-failure withdrawal, gauge migration, and permissionless rebalancing —
// nothing that requires the five vulnerabilities.
async function main(artifacts = compileContracts()) {
  const player = ethers.Wallet.createRandom();
  const chainId = 424242;
  const chain = await createChain(artifacts, player.address, chainId);

  // Manual-nonce transaction sender (same approach as solver/lib/transactions.js
  // and test/exploit-matrix.js): fetch the nonce fresh per transaction, sign a
  // legacy tx, broadcast, and await the receipt. Avoids ethers' nonce caching,
  // which goes stale and causes off-by-one nonce errors.
  const rpc = (method, params) => chain.eip1193.request({ method, params });
  const { chainId: networkId } = await chain.provider.getNetwork();
  const send = async (to, data) => {
    const nonce = BigInt(await rpc("eth_getTransactionCount", [player.address, "pending"]));
    const gasPrice = BigInt(await rpc("eth_gasPrice", []));
    const raw = await player.signTransaction({
      type: 0, chainId: networkId, nonce, gasLimit: 6_000_000n, gasPrice, to, data,
    });
    const txHash = await rpc("eth_sendRawTransaction", [raw]);
    const receipt = await rpc("eth_getTransactionReceipt", [txHash]);
    if (BigInt(receipt.status) !== 1n) throw new Error(`reverted (${txHash})`);
  };
  // Contract creation (used to deploy the attacker-owned DelegateProbe).
  const deploy = async (artifact, args = []) => {
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode);
    const tx = await factory.getDeployTransaction(...args);
    const nonce = BigInt(await rpc("eth_getTransactionCount", [player.address, "pending"]));
    const gasPrice = BigInt(await rpc("eth_gasPrice", []));
    const raw = await player.signTransaction({
      type: 0, chainId: networkId, nonce, gasLimit: 6_000_000n, gasPrice, to: null, data: tx.data,
    });
    const txHash = await rpc("eth_sendRawTransaction", [raw]);
    const receipt = await rpc("eth_getTransactionReceipt", [txHash]);
    if (BigInt(receipt.status) !== 1n) throw new Error(`deploy reverted (${txHash})`);
    return receipt.contractAddress;
  };
  // Read-only contract views go through the provider (no signer needed).
  const C = (nameOrAddress, artifact) => new ethers.Contract(
    chain.contracts[nameOrAddress] ?? nameOrAddress, artifacts[artifact].abi, chain.provider,
  );

  assert.equal((await chain.provider.getNetwork()).chainId, BigInt(chainId));
  assert.equal(Object.keys(chain.contracts).length, 19);

  const timelock = C("timelock", "TimelockController");
  const treasury = C("treasury", "Treasury");
  assert.equal(await treasury.governor(), chain.contracts.timelock);
  assert.equal(await timelock.hasRole(await timelock.PROPOSER_ROLE(), chain.contracts.governor), true);
  assert.equal(await timelock.hasRole(await timelock.EXECUTOR_ROLE(), ethers.ZeroAddress), true);

  const gov = C("gov", "Token");
  const vault = C("vault", "GovStakingVault");
  const mirror = C("mirror", "VoteMirror");
  await send(chain.contracts.gov, gov.interface.encodeFunctionData("approve", [chain.contracts.vault, ethers.MaxUint256]));
  await send(chain.contracts.vault, vault.interface.encodeFunctionData("stake", [E("100"), player.address]));
  assert.equal(await mirror.votes(player.address), E("100"));
  await send(chain.contracts.vault, vault.interface.encodeFunctionData("withdraw", [E("25")]));
  assert.equal(await vault.staked(player.address), E("75"));
  assert.equal(await mirror.votes(player.address), E("75"));

  // Contract delegation: deploy the player's own observer probe.
  const probeAddress = await deploy(artifacts.DelegateProbe, [player.address]);
  const probe = C(probeAddress, "DelegateProbe");
  await send(chain.contracts.vault, vault.interface.encodeFunctionData("withdraw", [E("75")]));
  await send(chain.contracts.vault, vault.interface.encodeFunctionData("stake", [E("50"), probeAddress]));
  assert.equal(await mirror.votes(probeAddress), E("50"));
  await send(chain.contracts.vault, vault.interface.encodeFunctionData("withdraw", [E("50")]));
  assert.equal(await mirror.votes(probeAddress), 0n);

  await send(chain.contracts.vault, vault.interface.encodeFunctionData("stake", [E("100"), player.address]));
  const governor = C("governor", "RiskGovernor");
  const treasuryAsset = C("treasuryAsset", "Token");
  const before = await treasuryAsset.balanceOf(player.address);
  await send(chain.contracts.governor, governor.interface.encodeFunctionData("proposeBatch", [[player.address], [E("10")]]));
  const proposalId = await governor.latestProposalId(player.address);
  assert.equal(await governor.criticalProposal(proposalId), false);
  await send(chain.contracts.governor, governor.interface.encodeFunctionData("castVote(uint256)", [proposalId]));
  await rpc("evm_mine", []);
  await rpc("evm_mine", []);
  await rpc("evm_mine", []);
  await send(chain.contracts.governor, governor.interface.encodeFunctionData("queueBatch", [proposalId]));
  await send(chain.contracts.governor, governor.interface.encodeFunctionData("executeBatch", [proposalId]));
  assert.equal(await treasuryAsset.balanceOf(player.address), before + E("10"));

  await send(chain.contracts.governor, governor.interface.encodeFunctionData("proposeBatch", [[player.address], [E("600")]]));
  const criticalId = await governor.latestProposalId(player.address);
  assert.equal(await governor.criticalProposal(criticalId), true);
  assert((await governor.readyAt(criticalId)) > (await governor.readyAt(proposalId)));

  const lending = C("lending", "LendingVault");
  let healthyReverted = false;
  try {
    await send(chain.contracts.lending, lending.interface.encodeFunctionData("liquidate", [chain.victim, 1n, 1n]));
  } catch {
    healthyReverted = true;
  }
  assert.equal(healthyReverted, true, "healthy same-epoch liquidation did not revert");
  assert.equal((await lending.positions(chain.victim)).open, true);

  const lp = C("lp", "Token");
  const staking = C("rewardStaking", "RewardStaking");
  await send(chain.contracts.lp, lp.interface.encodeFunctionData("approve", [chain.contracts.rewardStaking, E("20")]));
  await send(chain.contracts.rewardStaking, staking.interface.encodeFunctionData("stake", [E("20")]));
  await send(chain.contracts.rewardStaking, staking.interface.encodeFunctionData("withdraw", [E("5")]));
  assert.equal(await staking.balanceOf(player.address), E("15"));

  const marketAsset = C("marketAsset", "Token");
  const treasuryMarketBefore = await marketAsset.balanceOf(chain.contracts.treasury);
  await send(chain.contracts.treasury, treasury.interface.encodeFunctionData("rebalance", [E("1")]));
  assert.equal(await marketAsset.balanceOf(chain.contracts.treasury), treasuryMarketBefore - E("1"));

  await send(probeAddress, probe.interface.encodeFunctionData("setFailNegative", [false]));
  console.log("integration: legitimate DAO, lending, gauge, delegation and rebalance flows passed");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { runIntegration: main };
