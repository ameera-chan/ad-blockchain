const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");

// Canonical interface ABIs — pinned from the authoritative challenge source.
// The verifier NEVER fetches an ABI or /info from the target team: that would
// let a defender feed fake addresses or a fake interface to the judge. These
// minimal interfaces contain exactly the getters the verifier needs.
const ABIS = {
  IERC20: load("IERC20"),
  IVoteMirror: load("IVoteMirror"),
  IGovStakingVault: load("IGovStakingVault"),
  IDelegateProbe: load("IDelegateProbe"),
};

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "abi", `${name}.json`), "utf8"));
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
 * Verify an attacker's on-chain state against the organizer's authoritative
 * contract registry (team.contracts) and pinned ABIs — not the target's /info.
 */
async function validProof(team, player, kind, proof) {
  const iface = {
    token: new ethers.Interface(ABIS.IERC20),
    mirror: new ethers.Interface(ABIS.IVoteMirror),
    vault: new ethers.Interface(ABIS.IGovStakingVault),
    probe: new ethers.Interface(ABIS.IDelegateProbe),
  };
  const c = team.contracts;
  const call = (to, i, fn, ...args) => ethCall(team.rpc, to, i.encodeFunctionData(fn, args));

  if (kind === "oracle") return BigInt(await call(c.collateral, iface.token, "balanceOf", player)) >= ethers.parseEther("100");
  if (kind === "gauge") return BigInt(await call(c.reward, iface.token, "balanceOf", player)) >= ethers.parseEther("500");
  if (kind === "batch") return BigInt(await call(c.treasuryAsset, iface.token, "balanceOf", player)) >= ethers.parseEther("1000");
  if (kind === "sandwich") return BigInt(await call(c.marketAsset, iface.token, "balanceOf", player)) > ethers.parseEther("205");
  if (kind === "ghost") {
    const probe = ethers.getAddress(proof);
    const ownerRaw = await call(probe, iface.probe, "owner");
    const owner = ethers.getAddress(iface.probe.decodeFunctionResult("owner", ownerRaw)[0]);
    const votes = BigInt(await call(c.mirror, iface.mirror, "votes", probe));
    const stake = BigInt(await call(c.vault, iface.vault, "staked", player));
    return owner === player && votes >= ethers.parseEther("450") && stake === 0n;
  }
  return false;
}

module.exports = { validProof, ethCall };
