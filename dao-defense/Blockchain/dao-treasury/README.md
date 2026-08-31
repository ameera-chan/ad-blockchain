# DAO Treasury Defense

## What

This is a GZCTF Attack–Defense blockchain challenge. A session creates a fresh
Ganache chain containing isolated DAO, lending, reward, and AMM assets. The
default build intentionally contains five vulnerabilities. Defenders repair
the source while the checker protects legitimate behavior.

## Where

- `challenge.yml` defines the platform challenge.
- `src/` contains the service and contracts.
- `checker/` contains functionality-only SLA checks.
- `solver/` contains the official local solver: `solve.js` plus `lib/` (HTTP
  client, EIP-712 claims, raw-transaction plumbing) and one module per
  vulnerability under `solver/vulnerabilities/`. See `solver/README.md`.

## How to run

```sh
cd src
npm ci
npm test
npm start
```

The service listens on port `8080` by default. Create a session with:

```text
POST /session
{"player":"0x..."}
```

Use the returned `/rpc/<session-id>` endpoint. Only read methods and
`eth_sendRawTransaction` are allowed. Sessions expire after five minutes.

## Claim signing

Claims use EIP-712. `GET /claim-challenge/<id>` requires `player`, `kind`, and
`proof` query parameters and returns the exact `domain`, `types`, and `value`
to sign. The payload binds the session, player, vulnerability, proof, nonce,
chain ID, expiry, verifier contract, and current flag epoch. Each vulnerability
can be claimed once per session.

## Checker

The checker follows the `owasp-portal` layout. It checks health, fresh session
creation, chain identity, RPC restrictions, artifacts, the EIP-712 claim
schema, EOA and contract delegation, observer-failure withdrawals, gauge
migration claims, permissionless rebalancing, and the OpenZeppelin governance
queue and execution flow. It does not read the flag.

## Governance

Governance uses OpenZeppelin `Governor`, `GovernorVotes`,
`GovernorCountingSimple`, `GovernorSettings`, `GovernorTimelockControl`, and
`TimelockController`. The timelock owns treasury distribution authority. The
governor has the proposer role, execution is open, and the deployer renounces
the timelock admin role after setup.

## Tests

`npm test` runs security checks, obvious-overpatch mutation tests, five
single-repair compilation checks, full-repair functionality, vulnerable-build
functionality, and deterministic post-fee AMM profitability validation.

## Environment

- `PORT`: HTTP port; default `8080`.
- `SESSION_TTL_MS`: session lifetime; default `300000`.
- `MAX_SESSIONS`: live session limit; default `24`.
- `GZCTF_FLAG_FILE`: platform flag file; default `/flag`.
- `GZCTF_FLAG`: local fallback flag.
