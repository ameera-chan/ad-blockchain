# Attack Verifier (organizer-side)

The **organizer-controlled** exploit verifier and flag-release authority for the
DAO Treasury A&D challenge. Teams can patch their contracts; they cannot patch
the judge.

## Why it exists

The team service (self-hosted or organizer-hosted) must **not** decide whether
an attacker earns points. This verifier lives on the organizer side and, for
each claim, checks the on-chain exploit state against the organizer's own
authoritative data:

- **Pinned interface ABIs** (`abi/IERC20.json`, `abi/IVoteMirror.json`,
  `abi/IGovStakingVault.json`, `abi/IDelegateProbe.json`) — never fetched from
  the target team.
- **An authoritative contract registry** (`teams.json`) — never the target's
  `/info`.

Only after the signature and on-chain state both check out does it release the
team's flag.

## Round correctness (baseline-delta)

The verifier proves the attacker **gained** the required amount *during this
claim session*, not that they currently hold it. When a challenge is issued it
snapshots the player's balances (`collateral`, `reward`, `treasuryAsset`,
`marketAsset`); at claim time it re-reads them and verifies the **delta**:

- `oracle`     → `collateral`      +100
- `gauge`      → `reward`          +500
- `batch`      → `treasuryAsset`   +1000
- `sandwich`   → `marketAsset`     +>0

This means an attacker who exploited in round N cannot farm round N+1's flag on
the same balance — the delta is zero unless they exploit again. The ghost
vulnerability is scoped instead by a one-shot `usedProbes` set (each exploit
deploys a fresh probe; a reused proof address is rejected).

## Config (two secret-safe files)

| File | Purpose | Committed? |
|------|---------|-----------|
| `teams.json` | per-team registry: `rpc`, `chainId`, `contracts` | no (gitignored) |
| `flags.json` | per-team round flag (`{ teamId: "flag{…}" }`) | no (gitignored) |
| `teams.example.json` | committed template | yes |
| `flags.example.json` | committed template | yes |

Register a freshly-deployed team (captures addresses from its still-trusted
`/info`, then the verifier never needs `/info` again):

```sh
node register.js team01 http://<team-host>:8081 "flag{round-1}"
```

## Endpoints

| Endpoint | Access | Description |
|----------|--------|-------------|
| `GET /health` | public | `ok` |
| `GET /claim-challenge?team=&player=&kind=&proof=` | public | EIP-712 challenge (bound to flag epoch, 300s expiry) |
| `POST /claim` | public | verify signature + expiry + on-chain exploit state, release the flag |
| `GET /teams` | organizer | registry (rpc/chainId/contracts — no flags) |
| `POST /flag` | organizer | update a team's round flag (from the GZCTF checker) |
| `GET /status` | organizer | exploited vulns per team (for the dashboard) |

The organizer-only endpoints are gated by `ADMIN_TOKEN` (bearer header or
`?token=`). In production the verifier refuses to start without it.

## Flag rotation

`flags.json` is the per-round flag source of truth. Two ways to keep it current:

1. **Automatic (recommended):** the GZCTF checker calls the verifier's admin
   `POST /flag` every tick with `GZCTF_FLAG` + `GZCTF_TEAM_ID` + `GZCTF_ROUND`.
   Configure the checker with `VERIFIER_URL`, `VERIFIER_ADMIN_TOKEN` (matching
   the verifier's `ADMIN_TOKEN`), and optionally `VERIFIER_TEAM` to override
   the registry key. The verifier then always holds the same flag the target
   service was seeded with — no manual maintenance.
2. **Manual:** edit `flags.json` and restart the verifier (or call
   `POST /flag` yourself).

Each claim is scoped to the `flagEpoch` (hash of the flag) it was issued under:
a new round's flag re-arms the same `player+kind`, and a claim issued under a
previous flag is rejected with `flag rotated`.

## Run

```sh
npm ci
ADMIN_TOKEN=secret npm start            # listens on 9090
```

Or via Docker (the organizer stack):

```sh
ADMIN_TOKEN=secret docker compose up -d --build   # from the repo root
```
