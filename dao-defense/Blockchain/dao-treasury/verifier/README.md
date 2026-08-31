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

| Endpoint | Description |
|----------|-------------|
| `GET /health` | `ok` |
| `GET /teams` | registry (rpc/chainId/contracts — no flags) |
| `GET /claim-challenge?team=&player=&kind=&proof=` | EIP-712 challenge (bound to the flag epoch, 300s expiry) |
| `POST /claim` | verify signature + expiry + on-chain exploit state, release the flag |
| `GET /status` | exploited vulns per team (for the organizer dashboard) |

## Flag rotation

`flags.json` is the per-round flag source of truth. The organizer (or a GZCTF
flag-lifecycle hook) updates it each round — the verifier binds each claim to
the current `flagEpoch` (a hash of the flag), so stale claims are rejected.
Automating this from GZCTF's round/flag feed is the remaining integration step.

## Run

```sh
npm ci
npm start            # listens on 9090
```

Or via Docker (the organizer stack):

```sh
docker compose up -d --build   # from the repo root (see docker-compose.yml)
```
