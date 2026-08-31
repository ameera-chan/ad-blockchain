#!/usr/bin/env node
// Off-chain flag claim for the forge solver.
//
// The flags are released by the ORGANIZER verifier (HTTP + EIP-712), not by the
// team's service. After the forge scripts exploit the target chain, this helper
// submits the proof to the verifier, which checks the on-chain state via
// eth_call and releases the team's flag.
//
// Usage:
//   node claim.mjs <verifier> <privateKey> <teamId>
//   # ghost reads the probe address from probe.txt (written by ExploitGhost.s.sol)

import { ethers } from "ethers";
import { readFileSync } from "node:fs";

const VERIFIER = (process.argv[2] || process.env.VERIFIER || "http://127.0.0.1:9090").replace(/\/$/, "");
const KEY = process.argv[3] || process.env.PRIVATE_KEY;
const TEAM = process.argv[4] || process.env.TEAM || "team01";

if (!KEY) {
  console.error("usage: node claim.mjs <verifier> <privateKey> <teamId>");
  process.exit(1);
}

const wallet = new ethers.Wallet(KEY);
const ZERO = ethers.ZeroAddress;

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

let probe = ZERO;
try { probe = readFileSync("probe.txt", "utf8").trim(); } catch {}

const kinds = ["oracle", "gauge", "batch", "ghost", "sandwich"];
for (const kind of kinds) {
  const proof = kind === "ghost" ? probe : ZERO;
  try {
    const challenge = await request(
      "GET",
      `/claim-challenge?team=${TEAM}&player=${wallet.address}&kind=${kind}&proof=${proof}`,
    );
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
  }
}
