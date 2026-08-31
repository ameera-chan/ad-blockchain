const { ethers } = require("ethers");

// ---- JSON-RPC helpers against a team's public gateway -----------------------

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

async function ethCall(rpcUrl, to, data) {
  const res = await fetch(`${rpcUrl}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

/**
 * Verify that an attacker's on-chain state satisfies a vulnerability's success
 * condition. Reads the team's public gateway (never runs inside the team's
 * container), so a defender cannot disable flag release by patching their own
 * service.
 */
async function validProof(team, info, player, kind, proof) {
  const names = ["Token", "DelegateProbe", "VoteMirror", "GovStakingVault"];
  const abis = {};
  for (const name of names) {
    abis[name] = (await fetchJson(`${team.rpc}/artifact/${name}`)).abi;
  }
  const iface = {
    Token: new ethers.Interface(abis.Token),
    DelegateProbe: new ethers.Interface(abis.DelegateProbe),
    VoteMirror: new ethers.Interface(abis.VoteMirror),
    GovStakingVault: new ethers.Interface(abis.GovStakingVault),
  };
  const c = info.contracts;
  const call = (to, i, fn, ...args) => ethCall(team.rpc, to, i.encodeFunctionData(fn, args));

  if (kind === "oracle") return BigInt(await call(c.collateral, iface.Token, "balanceOf", player)) >= ethers.parseEther("100");
  if (kind === "gauge") return BigInt(await call(c.reward, iface.Token, "balanceOf", player)) >= ethers.parseEther("500");
  if (kind === "batch") return BigInt(await call(c.treasuryAsset, iface.Token, "balanceOf", player)) >= ethers.parseEther("1000");
  if (kind === "sandwich") return BigInt(await call(c.marketAsset, iface.Token, "balanceOf", player)) > ethers.parseEther("205");
  if (kind === "ghost") {
    const probe = ethers.getAddress(proof);
    const ownerRaw = await call(probe, iface.DelegateProbe, "owner");
    const owner = ethers.getAddress(iface.DelegateProbe.decodeFunctionResult("owner", ownerRaw)[0]);
    const votes = BigInt(await call(c.mirror, iface.VoteMirror, "votes", probe));
    const stake = BigInt(await call(c.vault, iface.GovStakingVault, "staked", player));
    return owner === player && votes >= ethers.parseEther("450") && stake === 0n;
  }
  return false;
}

module.exports = { validProof, ethCall, fetchJson };
