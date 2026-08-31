# DAO Treasury Defense

A GZCTF **Attack–Defense** blockchain challenge. Each team gets a self-hosted,
persistent Anvil chain running a DAO treasury (governance, lending, rewards,
AMM). The default build intentionally contains **five vulnerabilities**.
Defenders patch the `patchable/` contracts behind proxies; attackers exploit
the vulnerable state on opponents' chains to steal their round flag.

## Architecture

```
GZCTF
  │
  ▼
Team service :8080            (one container per team, self-hosted)
  │
  ├── /health  /info  /status  /faucet  /rpc  /claim-challenge  /claim
  │
  ▼
Internal Anvil                (spawned by deploy.js as a child of the gateway)
  │
  ▼
Team blockchain
  ├── Proxies   → patchable implementations (V1 … Vn)
  └── Supporting contracts (tokens, oracle, AMM, staking, timelock)
```

The gateway exposes only the public surface; Anvil's `8545` is never the
competition endpoint. The RPC proxy allows a fixed allowlist (read methods +
`eth_sendRawTransaction`) and blocks Anvil admin methods (`evm_*`, `anvil_*`).

## Repository layout

| Path | Purpose |
|------|---------|
| `challenge.yml` | GZCTF definition (`type: AttackDefense`) |
| `src/` | The running team service (built from `src/Dockerfile`) |
| `src/contracts/patchable/` | Contracts defenders modify, deployed behind proxies |
| `src/contracts/supporting/` | Infrastructure (tokens, oracle, AMM, staking) |
| `src/contracts/interfaces/` | Shared interfaces |
| `src/gateway/server.js` | The public HTTP surface (`/rpc`, `/info`, …) |
| `src/scripts/deploy.js` | Anvil lifecycle + proxy deployment |
| `checker/` | Organizer SLA checker (functionality-only) |
| `solver/` | Organizer reference exploit (Foundry scripts) |
| `dist/` | The defender package given to teams |

## How to run locally

```sh
cd src
npm ci
npm test
npm start            # or: GZCTF_FLAG=flag{local} node gateway/server.js
```

The service listens on `8080`. Use `/rpc` as the RPC endpoint, `/info` for the
proxy addresses, and `/faucet` to fund an attacker address with gas + tokens.

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | `ok` |
| `GET /info` | `chainId`, `rpcUrl`, proxy `contracts` map, `victim`, `vulnerabilities`, `upgradeAddress` |
| `GET /status` | which of the five vulns have been exploited (claimed) |
| `GET /artifact/:name` | compiled artifact ABI/bytecode |
| `POST /faucet` | fund `{player}` once per flag epoch |
| `POST /rpc` | proxied JSON-RPC to the internal Anvil (allowlisted) |
| `GET /claim-challenge` | EIP-712 challenge for a `(player, kind, proof)` |
| `POST /claim` | verify exploit state, mint the flag |

## Vulnerabilities

1. **oracle** — `LendingVault` mixes collateral/debt epochs (`LendingVault.sol`).
2. **gauge** — `LegacyGauge.claim` reads live balance instead of the frozen
   migrated balance (`LegacyGauge.sol`).
3. **batch** — `RiskGovernor.proposeBatch` classifies per-action instead of
   aggregate, bypassing the critical threshold (`RiskGovernor.sol`).
4. **ghost** — `VoteMirror.sync` swallows a failed observer callback and
   `withdraw` ignores the return (`VoteMirror.sol`, `GovStakingVault.sol`).
5. **sandwich** — `Treasury.rebalance` quotes the spot price and only guards 5%
   slippage (`Treasury.sol`).

## Defense workflow

Defenders patch `src/contracts/patchable/*.sol`, deploy the new implementation,
and repoint the proxy with their team upgrade key. The bundled `dist/tools/daoctl.sh`
CLI wraps this:

```sh
./daoctl info                       # the team's /info
./daoctl credentials                # upgrade key + address (from the mounted volume / env)
./daoctl upgrade <proxy> <contract> # deploy V2 + upgradeTo
```

Or do it manually:

```
forge create src/patchable/LendingVault.sol:LendingVault --rpc-url $RPC --private-key $UPGRADE_KEY --broadcast
cast send <proxy> "upgradeTo(address)" <newImpl> --rpc-url $RPC --private-key $UPGRADE_KEY
```

The proxy address stays stable; only the implementation changes.

## Checker

`checker/` is a functionality-only SLA harness (one-shot, `GZCTF_*` env vars,
exit code `0 Ok / 1 Mumble / 2 Offline / 3 InternalError`). It verifies health,
proxy code, token flows, staking, governance, and rebalancing — never whether a
vulnerability still exists.

## Environment

| Variable | Description |
|----------|-------------|
| `PORT` | HTTP port (default `8080`) |
| `CHAIN_ID` | Anvil chain id |
| `MNEMONIC` | optional deterministic deploy mnemonic |
| `GZCTF_FLAG_FILE` / `GZCTF_FLAG` | round flag (file or env; team-side this is only the round-reset signal) |
| `GZCTF_UPGRADE_KEY` | optional organizer-provisioned upgrade key override |
| `UPGRADE_KEY_FILE` | persisted upgrade key path (default `/data/secrets/upgrade-key`) |
