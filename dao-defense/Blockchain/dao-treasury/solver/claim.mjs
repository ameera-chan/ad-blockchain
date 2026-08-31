#!/usr/bin/env node
// Off-chain flag claim for the forge solver.
//
// The flags are released by the ORGANIZER verifier (HTTP + EIP-712), not by the
// team's service. The verifier is baseline-delta: it snapshots the attacker's
// balances when the challenge is ISSUED and verifies the delta at SUBMIT time.
// So the solver must issue the challenge BEFORE running the exploit, then submit
// AFTER. This helper exposes two steps:
//
//   node claim.mjs challenge <kind>   # GET /claim-challenge, save full payload
//   node claim.mjs submit <kind>      # sign + POST /claim
//
// Env: VERIFIER (default http://127.0.0.1:9090), PRIVATE_KEY, TEAM.
// Ghost reads the probe address from probe.txt (written by ExploitGhost.s.sol),
// so run the ghost exploit BEFORE `challenge ghost`.

import { ethers } from "ethers";
import { readFileSync, writeFileSync } from "node:fs";

const VERIFIER = (process.env.VERIFIER || "http://127.0.0.1:9090").replace(/\/$/, "");
const KEY = process.env.PRIVATE_KEY;
const TEAM = process.env.TEAM || "team01";
const [action, kind] = process.argv.slice(2);

const KINDS = ["oracle", "gauge", "batch", "ghost", "sandwich"];

if (!KEY) {
  console.error("set PRIVATE_KEY");
  process.exit(1);
}
if (!["challenge", "submit"].includes(action) || !KINDS.includes(kind)) {
  console.error("usage: node claim.mjs <challenge|submit> <kind>");
  process.exit(1);
}

const wallet = new ethers.Wallet(KEY);
const ZERO = ethers.ZeroAddress;
const STATE_FILE = `.claim-${kind}.json`;

async function request(method, path, json) {
  const res = await fetch(VERIFIER + path, {
    method,
    headers: json ? { "content-type": "application/json" } : undefined,
    body: json ? JSON.stringify(json) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

function proofFor(kind) {
  if (kind !== "ghost") return ZERO;
  return (readFileSync("probe.txt", "utf8").trim()) || ZERO;
}

if (action === "challenge") {
  const proof = proofFor(kind);
  const challenge = await request(
    "GET",
    `/claim-challenge?team=${TEAM}&player=${wallet.address}&kind=${kind}&proof=${proof}`,
  );
  // Save the full challenge so submit can sign the exact payload the verifier
  // bound to the (already-captured) baseline.
  writeFileSync(STATE_FILE, JSON.stringify({ proof, challenge }));
  console.log(`[challenge] ${kind} issued`);
} else {
  try {
    const { proof, challenge } = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    const signature = await wallet.signTypedData(challenge.domain, challenge.types, challenge.value);
    const result = await request("POST", "/claim", {
      team: TEAM,
      kind,
      player: wallet.address,
      proof,
      nonce: challenge.value.nonce,
      signature,
    });
    console.log(`[OK]   ${kind}: ${result.flag}`);
  } catch (error) {
    console.log(`[FAIL] ${kind}: ${error.message}`);
    process.exitCode = 1;
  }
}
