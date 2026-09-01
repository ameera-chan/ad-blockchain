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
  if (!res.ok) throw new Error(`target RPC HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

function interfaces() {
  return {
    token: new ethers.Interface(ABIS.IERC20),
    mirror: new ethers.Interface(ABIS.IVoteMirror),
    vault: new ethers.Interface(ABIS.IGovStakingVault),
    probe: new ethers.Interface(ABIS.IDelegateProbe),
  };
}

async function readState(team, player, proof) {
  const iface = interfaces();
  const c = team.contracts;
  const call = (to, i, fn, ...args) => ethCall(team.rpc, to, i.encodeFunctionData(fn, args));

  const state = {
    collateral: BigInt(await call(c.collateral, iface.token, "balanceOf", player)),
    reward: BigInt(await call(c.reward, iface.token, "balanceOf", player)),
    treasuryAsset: BigInt(await call(c.treasuryAsset, iface.token, "balanceOf", player)),
    marketAsset: BigInt(await call(c.marketAsset, iface.token, "balanceOf", player)),
  };

  if (proof && proof !== ethers.ZeroAddress) {
    const ownerRaw = await call(proof, iface.probe, "owner");
    state.probeOwner = ethers.getAddress(iface.probe.decodeFunctionResult("owner", ownerRaw)[0]);
    state.probeVotes = BigInt(await call(c.mirror, iface.mirror, "votes", proof));
  } else {
    state.probeOwner = ethers.ZeroAddress;
    state.probeVotes = 0n;
  }
  state.staked = BigInt(await call(c.vault, iface.vault, "staked", player));

  return state;
}

const DELTA = {
  oracle: ethers.parseEther("100"),
  gauge: ethers.parseEther("500"),
  batch: ethers.parseEther("1000"),
  // The reference sandwich starts with 200 MKT and ends above 205 MKT. Require
  // a meaningful net profit rather than merely `> 0`, which could be satisfied
  // by unrelated transfers or by calling the faucet after the baseline snapshot.
  sandwich: ethers.parseEther("5"),
};

async function validProof(team, player, kind, proof, baseline) {
  const now = await readState(team, player, proof);

  if (kind === "oracle") return now.collateral - baseline.collateral >= DELTA.oracle;
  if (kind === "gauge") return now.reward - baseline.reward >= DELTA.gauge;
  if (kind === "batch") return now.treasuryAsset - baseline.treasuryAsset >= DELTA.batch;
  if (kind === "sandwich") return now.marketAsset - baseline.marketAsset >= DELTA.sandwich;
  if (kind === "ghost") {
    return now.probeOwner === player && now.probeVotes >= ethers.parseEther("450") && now.staked === 0n;
  }
  return false;
}

module.exports = { validProof, readState, ethCall, DELTA };
