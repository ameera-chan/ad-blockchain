# Attack Verifier (organizer-side)

The **organizer-controlled** exploit verifier and flag-release authority for the
DAO Treasury A&D challenge. Teams can patch their contracts; they cannot patch
the judge.

## Trust boundary

The verifier uses only organizer-owned data for judging claims:

- pinned interface ABIs under `abi/`;
- the authoritative `teams.json` contract registry;
- the GZCTF round flag synchronized by the checker.

It never fetches `/info` or `/artifact` from a defender while deciding a claim.

## Round correctness

Balance-based proofs use a baseline captured when `/claim-challenge` is issued
and require a fresh gain before `/claim`:

| Kind | Required session delta |
|---|---:|
| `oracle` | +100 collateral |
| `gauge` | +500 reward |
| `batch` | +1000 treasury asset |
| `sandwich` | +5 market asset |

For `sandwich`, the player must already hold the 200 MKT starter allocation
before requesting the challenge. This prevents `challenge -> faucet -> claim`
from being mistaken for sandwich profit.

Ghost proofs are one-shot by probe address. Successful claims and used probe
addresses are persisted in `STATE_FILE`; short-lived claim nonces intentionally
remain in memory.

## Files

| File | Purpose | Committed? |
|---|---|---|
| `teams.json` | authoritative per-team RPC/contract registry | no |
| `flags.json` | current GZCTF flag per team | no |
| `state.json` / `STATE_FILE` | round numbers, successful claims, used ghost probes | no |
| `teams.example.json` | registry template | yes |
| `flags.example.json` | flag template | yes |

## Endpoints

| Endpoint | Access | Description |
|---|---|---|
| `GET /health` | public | health check |
| `GET /claim-challenge` | public, rate-limited | issue an EIP-712 challenge and capture baseline state |
| `POST /claim` | public | verify signature, epoch and exploit-state delta |
| `GET /teams` | organizer | authoritative target registry |
| `POST /flag` | organizer | synchronize the current GZCTF flag + round |
| `GET /status` | organizer | current-round exploit status |

Organizer endpoints require `Authorization: Bearer <ADMIN_TOKEN>`. In
`NODE_ENV=production`, the verifier refuses to start without `ADMIN_TOKEN`.

## Flag / round synchronization

The custom GZCTF checker calls `POST /flag` each tick with
`GZCTF_FLAG`, `GZCTF_TEAM_ID`, and `GZCTF_ROUND`. Configure the checker with:

```text
VERIFIER_URL
VERIFIER_ADMIN_TOKEN
```

Rounds are monotonic. A late checker from an older round receives `409 stale
round` and cannot roll the verifier back to an old flag. A conflicting flag for
the same round is also rejected.

## Abuse controls

`GET /claim-challenge` is bounded by both IP and player-address rate limits, and
expired nonce sessions are cleaned periodically. Defaults can be adjusted with:

```text
CLAIM_TTL_SECONDS=300
CLAIM_RATE_WINDOW_MS=60000
CLAIM_RATE_MAX=30
```

## Run

```sh
npm ci
ADMIN_TOKEN=secret npm start
```

With Docker Compose, `state.json` lives on the `verifier-state` named volume:

```sh
ADMIN_TOKEN=secret docker compose up -d --build
```
