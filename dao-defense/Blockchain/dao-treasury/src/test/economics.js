const assert = require("node:assert/strict");
const { ethers } = require("ethers");
const { compileContracts } = require("../lib/compiler");
const { createChain } = require("../scripts/deploy");

const E = ethers.parseEther;

async function main() {
  const artifacts = compileContracts();
  const player = ethers.Wallet.createRandom();
  const chain = await createChain(artifacts, player.address, 434343);

  // Manual per-tx nonce (same pattern as deploy.js / integration.js / exploit-matrix.js).
  const rpc = (method, params) => chain.eip1193.request({ method, params });
  const { chainId } = await chain.provider.getNetwork();
  const send = async (to, data, value = 0n) => {
    const nonce = BigInt(await rpc("eth_getTransactionCount", [player.address, "pending"]));
    const gasPrice = BigInt(await rpc("eth_gasPrice", []));
    const raw = await player.signTransaction({ type: 0, chainId, nonce, gasLimit: 6_000_000n, gasPrice, to, data, value });
    const txHash = await rpc("eth_sendRawTransaction", [raw]);
    const receipt = await rpc("eth_getTransactionReceipt", [txHash]);
    if (BigInt(receipt.status) !== 1n) throw new Error(`reverted (${txHash})`);
  };

  const tokenIface = new ethers.Interface(artifacts.Token.abi);
  const ammIface = new ethers.Interface(artifacts.ConstantProductAMM.abi);
  const treasuryIface = new ethers.Interface(artifacts.Treasury.abi);
  const tx = (to, iface, method, args = []) => send(to, iface.encodeFunctionData(method, args));
  const view = async (to, iface, method, args = []) =>
    BigInt(await chain.provider.call({ to, data: iface.encodeFunctionData(method, args) }));

  const { marketAsset, stable, amm, treasury } = chain.contracts;

  await tx(marketAsset, tokenIface, "approve", [amm, E("200")]);
  await tx(amm, ammIface, "swap", [marketAsset, E("200"), 0, player.address]);
  await tx(treasury, treasuryIface, "rebalance", [E("100")]);
  const settlement = await view(stable, tokenIface, "balanceOf", [player.address]);
  await tx(stable, tokenIface, "approve", [amm, settlement]);
  await tx(amm, ammIface, "swap", [stable, settlement, 0, player.address]);

  const finalBalance = await view(marketAsset, tokenIface, "balanceOf", [player.address]);
  assert(finalBalance > E("205"), `profit below claim threshold: ${ethers.formatEther(finalBalance)}`);
  console.log(`economics: deterministic post-fee market balance ${ethers.formatEther(finalBalance)} MKT`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
