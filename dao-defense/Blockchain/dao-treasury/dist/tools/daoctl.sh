#!/usr/bin/env bash
# daoctl — minimal defender CLI for the DAO Treasury A&D challenge.
#
#   daoctl info                          # fetch the team service /info
#   daoctl credentials                   # print upgrade key + address (from the mounted volume / env)
#   daoctl upgrade <proxy> <contract>    # deploy V2 + repoint the proxy
#
# Environment:
#   RPC_URL          team service base URL (default http://127.0.0.1:8080)
#   UPGRADE_KEY      upgrade private key (fallback: $UPGRADE_KEY_FILE)
#   UPGRADE_KEY_FILE path to the persisted key (default /data/secrets/upgrade-key)
set -euo pipefail

RPC="${RPC_URL:-${GZCTF_TARGET:-http://127.0.0.1:8080}}"
RPC="${RPC%/}"
KEY_FILE="${UPGRADE_KEY_FILE:-/data/secrets/upgrade-key}"

key() {
  local k="${UPGRADE_KEY:-}"
  if [ -z "$k" ] && [ -f "$KEY_FILE" ]; then k="$(cat "$KEY_FILE")"; fi
  if [ -z "$k" ]; then echo "error: no upgrade key — set UPGRADE_KEY or mount $KEY_FILE" >&2; exit 1; fi
  echo "$k"
}

info() {
  curl -s "$RPC/info" | python3 -m json.tool 2>/dev/null || curl -s "$RPC/info"
}

credentials() {
  local k
  k="$(key)"
  echo "Upgrade Key:     $k"
  echo "Upgrade Address: $(cast wallet address --private-key "$k")"
}

upgrade() {
  local proxy="$1" contract="$2" k impl
  k="$(key)"
  impl="$(forge create "$contract" --rpc-url "$RPC/rpc" --private-key "$k" --json \
    | grep -o '"deployedTo":"0x[0-9a-fA-F]*"' | cut -d'"' -f4)"
  echo "implementation: $impl"
  cast send "$proxy" "upgradeTo(address)" "$impl" \
    --rpc-url "$RPC/rpc" --private-key "$k" --gas-limit 200000 --confirmations 1
}

case "${1:-help}" in
  info) info ;;
  credentials) credentials ;;
  upgrade) [ "$#" -eq 3 ] || { echo "usage: daoctl upgrade <proxy> <contract>"; exit 1; }; upgrade "$2" "$3" ;;
  *) echo "usage: daoctl {info|credentials|upgrade <proxy> <contract>}" ;;
esac
