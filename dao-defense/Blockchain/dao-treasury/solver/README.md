# Forge Solver (`.s.sol`)

The five exploits as standalone Foundry scripts. Each one runs a single
vulnerability against the target's persistent chain; the flag claim (off-chain
HTTP + EIP-712) is handled by `claim.mjs` because the service mints flags
server-side, not through an on-chain `isSolved()`.

## Setup

```bash
forge install foundry-rs/forge-std
forge install OpenZeppelin/openzeppelin-contracts@v4.9.6
forge install OpenZeppelin/openzeppelin-contracts-upgradeable@v4.9.6
```

> **Remapping note:** `foundry.toml` maps `@openzeppelin/*/` to the **flattened**
> npm layout (`.sol` files directly at the package root). If you install via
> `forge install` (the GitHub repos), the OpenZeppelin sources live under a
> `contracts/` subdirectory — so change those two remappings to
> `lib/openzeppelin-contracts/contracts/` and
> `lib/openzeppelin-contracts-upgradeable/contracts/` respectively.

## One-shot

```bash
./solve.sh http://TARGET:8080 0xYOUR_PRIVATE_KEY
```

This funds your wallet via `/faucet`, fetches `/info`, runs the five scripts,
then claims all five flags.

## Manual (if you prefer running forge yourself)

```bash
# 1. Fund your wallet.
curl -X POST http://TARGET:8080/faucet -H 'content-type: application/json' \
  -d '{"player":"0xYOUR_ADDRESS"}'

# 2. Export the target addresses (from GET /info) as env vars, then:
export PLAYER=0xYOUR_ADDRESS
export RPC=http://TARGET:8080/rpc

forge script script/ExploitOracle.s.sol   --rpc-url $RPC --private-key 0xKEY --broadcast -vv
forge script script/ExploitGauge.s.sol    --rpc-url $RPC --private-key 0xKEY --broadcast -vv
forge script script/ExploitBatch.s.sol    --rpc-url $RPC --private-key 0xKEY --broadcast -vv
forge script script/ExploitGhost.s.sol    --rpc-url $RPC --private-key 0xKEY --broadcast -vv
forge script script/ExploitSandwich.s.sol --rpc-url $RPC --private-key 0xKEY --broadcast -vv

# 3. Claim (ExploitGhost writes probe.txt for the ghost proof).
node claim.mjs http://TARGET:8080 0xKEY
```

## Scripts

| Script | Vulnerability | Win condition |
|---|---|---|
| `ExploitOracle.s.sol` | LendingVault epoch mixing | `collateral >= 100` |
| `ExploitGauge.s.sol` | LegacyGauge frozen-debt claim | `reward >= 500` |
| `ExploitBatch.s.sol` | proposeBatch aggregate classification | `treasuryAsset >= 1000` |
| `ExploitGhost.s.sol` | VoteMirror failed-callback skip | probe owner + `votes >= 450` + `staked == 0` |
| `ExploitSandwich.s.sol` | Treasury spot-price rebalance | `marketAsset > 205` |

Each script reads its inputs from env vars via `vm.envAddress(...)`; run one or
all — they are independent (each needs a fresh faucet-funded wallet because the
exploits consume per-round state).
