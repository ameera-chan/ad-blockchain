#!/usr/bin/env node
// Off-chain flag claim for the forge solver.
//
// The flags are minted by the service (HTTP + EIP-712), NOT by an on-chain
// isSolved(), so this is the one step forge cannot do. It reuses the exact
// CLAIM_TYPES the service expects; `cast` has no clean sign-typed-data, which
// is why this helper exists.
//
// Usage:
//   node claim.mjs <target> <privateKey>
//   # ghost reads the probe address from probe.txt (written by ExploitGhost.s.sol)

import { ethers } from "ethers";
import { readFileSync } from "node:fs";

const TARGET = (process.argv[2] || "http://127.0.0.1:8080").replace(/\/$/, "");
const KEY = process.argv[3] || process.env.PRIVATE_KEY;

if (!KEY) {
  console.error("usage: node claim.mjs <target> <privateKey>");
  process.exit(1);
}

const wallet = new ethers.Wallet(KEY);
const ZERO = ethers.ZeroAddress;

async function request(method, path, json) {
  const res = await fetch(TARGET + path, {
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
      `/claim-challenge?player=${wallet.address}&kind=${kind}&proof=${proof}`,
    );
    const signature = await wallet.signTypedData(challenge.domain, challenge.types, challenge.value);
    const result = await request("POST", "/claim", {
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
