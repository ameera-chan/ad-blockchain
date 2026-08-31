# DAO Treasury Defense

A GZCTF **Attack–Defense** blockchain challenge. Each team gets an isolated
persistent EVM environment running a DAO treasury (governance, lending,
rewards, AMM). The default build intentionally contains **five
vulnerabilities**. Defenders patch the `patchable/` contracts behind proxies;
attackers exploit the vulnerable state on opponents' chains to steal their
round flag.

## Architecture

```
GZCTF (competition UI: teams, routing, scoreboard, SLA)
  │
  ├── SLA checker          — "does the service still work?"  (organizer)
  ├── Attack verifier      — "did this attacker exploit it?" (organizer)
  │
  ▼
Team service :8080            (one container per team)
  │
  ├── /health  /info  /artifact  /faucet  /rpc
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

### Trust boundary

Exploit verification and flag release live in the **organizer-side verifier**,
never in the team service. The team can patch contracts; it cannot patch the
judge. The verifier reads only the organizer's own contract registry + pinned
ABIs — it never trusts a team's `/info` or `/artifact`.

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
| `verifier/` | Organizer attack verifier (scoring authority) |
| `solver/` | Organizer reference exploit (Foundry scripts) |
| `dist/` | The defender package given to teams |
| `organizer/` | Private organizer dashboard |

## How to run locally

```sh
cd src
npm ci
npm test
npm start            # or: GZCTF_FLAG=flag{local} node gateway/server.js
```

The service listens on `8080`. Use `/rpc` as the RPC endpoint, `/info` for the
proxy addresses, and `/faucet` to fund an attacker address with gas + tokens.

## Team service endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | `ok` |
| `GET /info` | `chainId`, `rpcUrl`, proxy `contracts` map, `victim`, `vulnerabilities`, `upgradeAddress` |
| `GET /artifact/:name` | compiled artifact ABI/bytecode |
| `POST /faucet` | fund `{player}` once per flag epoch |
| `POST /rpc` | proxied JSON-RPC to the internal Anvil (allowlisted) |

Note: there is **no** `/claim` or `/status` on the team service. Exploit
verification and flag release happen through the organizer verifier.

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

The proxy address stays stable; only the implementation changes.

## Attacker workflow

```sh
cd solver
VERIFIER=http://<verifier>:9090 TEAM=team02 ./solve.sh http://<team02-host>:8081 <playerKey>
```

The solver exploits the target's `/rpc`, then submits the proof to the
organizer verifier (`/claim-challenge` → `/claim`), which checks the on-chain
state and releases the flag.

## Environment (team service)

| Variable | Description |
|----------|-------------|
| `PORT` | HTTP port (default `8080`) |
| `CHAIN_ID` | Anvil chain id |
| `MNEMONIC` | optional deterministic deploy mnemonic |
| `GZCTF_FLAG_FILE` / `GZCTF_FLAG` | round flag (team-side this is only the round-reset signal) |
| `GZCTF_UPGRADE_KEY` | optional organizer-provisioned upgrade key override |
| `UPGRADE_KEY_FILE` | persisted upgrade key path (default `/data/secrets/upgrade-key`) |
