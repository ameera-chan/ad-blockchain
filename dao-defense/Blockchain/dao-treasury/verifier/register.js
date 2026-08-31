#!/usr/bin/env node
// Registers a freshly-deployed team into the verifier's two config files:
//   teams.json — authoritative contract registry (rpc, chainId, contracts)
//   flags.json — per-team round flag
//
// Run this ONCE per team from the organizer side, against a team service that
// is still trusted (immediately after deploy, before the team takes control —
// or, for organizer-hosted chains, always). It captures the team's contract
// addresses + chain id so the verifier never trusts the team's /info again.
//
//   node register.js <teamId> <rpcUrl> <flag>
const fs = require("node:fs");
const path = require("node:path");

const TEAMS_FILE = process.env.TEAMS_FILE || path.join(__dirname, "teams.json");
const FLAGS_FILE = process.env.FLAGS_FILE || path.join(__dirname, "flags.json");
const [teamId, rpcUrl, flag] = process.argv.slice(2);

if (!teamId || !rpcUrl || !flag) {
  console.error("usage: node register.js <teamId> <rpcUrl> <flag>");
  process.exit(1);
}

const CONTRACT_KEYS = ["treasury", "mirror", "vault", "collateral", "reward", "treasuryAsset", "marketAsset"];

(async () => {
  const info = await (await fetch(`${rpcUrl.replace(/\/$/, "")}/info`)).json();
  const contracts = {};
  for (const key of CONTRACT_KEYS) {
    if (!info.contracts?.[key]) {
      console.error(`team /info is missing contract "${key}"`);
      process.exit(1);
    }
    contracts[key] = info.contracts[key];
  }

  const teams = fs.existsSync(TEAMS_FILE) ? JSON.parse(fs.readFileSync(TEAMS_FILE, "utf8")) : {};
  teams[teamId] = { rpc: rpcUrl.replace(/\/$/, ""), chainId: info.chainId, contracts };
  fs.writeFileSync(TEAMS_FILE, JSON.stringify(teams, null, 2) + "\n");

  const flags = fs.existsSync(FLAGS_FILE) ? JSON.parse(fs.readFileSync(FLAGS_FILE, "utf8")) : {};
  flags[teamId] = flag;
  fs.writeFileSync(FLAGS_FILE, JSON.stringify(flags, null, 2) + "\n");

  console.log(`registered ${teamId} -> ${rpcUrl} (chain ${info.chainId})`);
})();
