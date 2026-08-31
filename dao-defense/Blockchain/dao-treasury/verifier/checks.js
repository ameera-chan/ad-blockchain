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

function interfaces() {
  return {
    token: new ethers.Interface(ABIS.IERC20),
    mirror: new ethers.Interface(ABIS.IVoteMirror),
    vault: new ethers.Interface(ABIS.IGovStakingVault),
    probe: new ethers.Interface(ABIS.IDelegateProbe),
  };
}

/**
 * Read the on-chain state the verifier needs for a given player/proof. Used to
 * snapshot the baseline at /claim-challenge time and to re-read it at /claim
 * time, so a proof is a DELTA over the claim session rather than an absolute
 * "currently owns X" (which a player could farm across rounds).
 */
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

// Delta thresholds = the exploit's NET gain (not the faucet seed). The faucet
// mints 200 marketAsset (and nothing for collateral/reward/treasuryAsset), so
// these deltas are measured strictly over the claim session after the faucet.
const DELTA = {
  oracle: ethers.parseEther("100"),   // liquidate seizes 100 collateral
  gauge: ethers.parseEther("500"),    // gauge claim nets ~600 reward
  batch: ethers.parseEther("1000"),   // batch drains 1040 treasury asset
};

/**
 * Verify an attacker's on-chain state against the organizer's authoritative
 * contract registry (team.contracts) and pinned ABIs — not the target's /info.
 *
 * `baseline` is the state snapshot captured when the claim challenge was
 * issued; `now` is re-read at claim time. Balance-based vulnerabilities require
 * the DELTA to meet the threshold, so a previous round's leftover balance does
 * not satisfy a new claim.
 */
async function validProof(team, player, kind, proof, baseline) {
  const now = await readState(team, player, proof);

  if (kind === "oracle") return now.collateral - baseline.collateral >= DELTA.oracle;
  if (kind === "gauge") return now.reward - baseline.reward >= DELTA.gauge;
  if (kind === "batch") return now.treasuryAsset - baseline.treasuryAsset >= DELTA.batch;
  // Sandwich: any positive market-asset gain this session proves a fresh
  // rebalance was executed. A positive-but-bounded gain cannot come from the
  // faucet (which is pre-challenge and rate-limited once per epoch).
  if (kind === "sandwich") return now.marketAsset - baseline.marketAsset > 0n;
  // Ghost: absolute conditions are safe because the proof is a freshly-deployed
  // probe (enforced by the usedProbes set in server.js), so 450 votes can only
  // have accumulated via this round's stake/withdraw exploit.
  if (kind === "ghost") {
    return now.probeOwner === player && now.probeVotes >= ethers.parseEther("450") && now.staked === 0n;
  }
  return false;
}

module.exports = { validProof, readState, ethCall };
