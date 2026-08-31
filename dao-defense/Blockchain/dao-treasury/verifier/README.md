# Attack Verifier (organizer-side)

The **organizer-controlled** exploit verifier and flag-release authority for the
DAO Treasury A&D challenge.

## Why it exists

The team service (self-hosted by each team) must **not** decide whether an
attacker earns points. This verifier lives on the organizer side: it reads a
team's public `/info` + `/rpc`, checks the on-chain exploit state via
`eth_call`, and only then releases that team's flag. A defender patching their
own service cannot disable flag release.

## Config

`teams.json` maps each team id to its gateway URL and current round flag:

```json
{
  "team01": { "rpc": "http://<team-host>:8081", "flag": "flag{round-1-team01}" },
  "team02": { "rpc": "http://<team-host>:8082", "flag": "flag{round-1-team02}" }
}
```

Update the `flag` per round. Override the path with `TEAMS_FILE`.

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | `ok` |
| `GET /teams` | team ids |
| `GET /claim-challenge?team=&player=&kind=&proof=` | EIP-712 challenge |
| `POST /claim` | verify signature + exploit state, release the flag |
| `GET /status` | exploited vulns per team |

## Run

```sh
npm ci
npm start            # listens on 9090
```
