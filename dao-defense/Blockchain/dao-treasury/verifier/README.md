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
| `GET /status` | organizer | exploited vulns per team (for the dashboard) |

The organizer-only endpoints are gated by `ADMIN_TOKEN` (bearer header or
`?token=`). When `ADMIN_TOKEN` is unset (local dev), they are open.

## Flag rotation

`flags.json` is the per-round flag source of truth. The organizer (or a GZCTF
flag-lifecycle hook) rewrites it in place each round — the verifier **re-reads
it on every claim** (no restart needed), and each claim is scoped to the
`flagEpoch` (hash of the flag) it was issued under:

- A new round's flag automatically re-arms the same `player+kind`.
- A claim issued under a previous flag is rejected with `flag rotated`.

> **Remaining integration:** the *source* of `flags.json` must be GZCTF's
> round/flag feed so both the target's `/flag` and the verifier agree on the
> current team flag. Until that hook is wired, the organizer updates
> `flags.json` (or re-runs `register.js`) each round.

## Run

```sh
npm ci
ADMIN_TOKEN=secret npm start            # listens on 9090
```

Or via Docker (the organizer stack):

```sh
ADMIN_TOKEN=secret docker compose up -d --build   # from the repo root
```
