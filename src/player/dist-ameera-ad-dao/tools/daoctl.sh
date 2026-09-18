#!/usr/bin/env bash
set -euo pipefail

TARGET="${RPC_URL:-${GZCTF_TARGET:-http://127.0.0.1:8080/rpc}}"
TARGET="${TARGET%/}"
if [[ "$TARGET" == */rpc ]]; then
  RPC="$TARGET"
  SERVICE="${TARGET%/rpc}"
else
  SERVICE="$TARGET"
  RPC="$TARGET/rpc"
fi
KEY_FILE="${UPGRADE_KEY_FILE:-/data/private/UPGRADE_KEY}"
PLAYER_KEY_FILE="${PLAYER_KEY_FILE:-/data/private/PRIVKEY}"

key() {
  local k="${UPGRADE_KEY:-}"
  if [ -z "$k" ] && [ -f "$KEY_FILE" ]; then k="$(cat "$KEY_FILE")"; fi
  if [ -z "$k" ]; then echo "error: no upgrade key — set UPGRADE_KEY or mount $KEY_FILE" >&2; exit 1; fi
  echo "$k"
}

info() {
  curl -fsS "$SERVICE/self-info" | python3 -m json.tool
}

credentials() {
  local k
  k="$(key)"
  echo "Upgrade Key:     $k"
  echo "Upgrade Address: $(cast wallet address --private-key "$k")"
}

player_key() {
  local k="${PLAYER_KEY:-}"
  if [ -z "$k" ] && [ -f "$PLAYER_KEY_FILE" ]; then k="$(cat "$PLAYER_KEY_FILE")"; fi
  if [ -z "$k" ]; then echo "error: no player key — set PLAYER_KEY or read $PLAYER_KEY_FILE" >&2; exit 1; fi
  echo "$k"
}

faucet() {
  local k player body
  k="$(player_key)"
  player="$(cast wallet address --private-key "$k")"
  body="$(PLAYER="$player" python3 -c 'import json,os; print(json.dumps({"player":os.environ["PLAYER"]}))')"
  curl -fsS -X POST -H 'Content-Type: application/json' --data "$body" "$SERVICE/faucet"
  printf '\n'
}

upgrade() {
  local proxy="$1" contract="$2" k impl
  k="$(key)"
  impl="$(forge create "$contract" --rpc-url "$RPC" --private-key "$k" --broadcast --json \
    | sed -n 's/.*"deployedTo"[[:space:]]*:[[:space:]]*"\(0x[0-9a-fA-F]*\)".*/\1/p')"
  if [ -z "$impl" ]; then echo "error: forge did not return a deployed implementation address" >&2; exit 1; fi
  echo "implementation: $impl"
  cast send "$proxy" "upgradeTo(address)" "$impl" \
    --rpc-url "$RPC" --private-key "$k" --gas-limit 200000 --confirmations 1
}

claim() {
  local k
  k="$(player_key)"

  local player challenge nonce message signature body
  player="$(cast wallet address --private-key "$k")"
  challenge="$(curl -fsSG --data-urlencode "player=$player" "$SERVICE/claim-challenge")"
  nonce="$(printf '%s' "$challenge" | python3 -c 'import json,sys; print(json.load(sys.stdin)["nonce"])')"
  message="$(printf '%s' "$challenge" | python3 -c 'import json,sys; print(json.load(sys.stdin)["message"])')"
  signature="$(cast wallet sign --private-key "$k" "$message")"
  body="$(NONCE="$nonce" SIGNATURE="$signature" python3 -c 'import json,os; print(json.dumps({"nonce":os.environ["NONCE"],"signature":os.environ["SIGNATURE"]}))')"
  curl -fsS -X POST -H 'Content-Type: application/json' --data "$body" "$SERVICE/flag"
  printf '\n'
}

case "${1:-help}" in
  info) info ;;
  credentials) credentials ;;
  faucet) faucet ;;
  upgrade) [ "$#" -eq 3 ] || { echo "usage: daoctl upgrade <proxy> <contract>"; exit 1; }; upgrade "$2" "$3" ;;
  claim) claim ;;
  *) echo "usage: daoctl {info|credentials|faucet|claim|upgrade <proxy> <contract>}" ;;
esac
