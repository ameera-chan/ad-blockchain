# DAO Treasury Defense — Defender Kit

This is the package teams receive to defend their instance. It contains the
challenge source, an upgrade script, tests, and a small CLI.

## What you receive

| Item | Where |
|------|-------|
| Challenge source (patchable + supporting + interfaces) | `src/` |
| Upgrade script | `script/Upgrade.s.sol` |
| Functionality test | `test/DaoDefense.t.sol` |
| CLI | `tools/daoctl.sh` |
| Foundry config | `foundry.toml` |

## Setup

```sh
forge install foundry-rs/forge-std
forge install OpenZeppelin/openzeppelin-contracts@v4.9.6
forge install OpenZeppelin/openzeppelin-contracts-upgradeable@v4.9.6
forge build
```

> **Remapping note:** this repo's `foundry.toml` maps `@openzeppelin/*/` to the
> flattened npm layout. If you install via `forge install`, change the
> remappings to `lib/openzeppelin-contracts/contracts/` and
> `lib/openzeppelin-contracts-upgradeable/contracts/` respectively.

## Your credentials

| Credential | Purpose |
|-----------|---------|
| Your upgrade key | team private key (authorizes the proxy admin) |
| Your player key | any self-generated key (funded via `POST /faucet`) |

> **Where your upgrade key comes from:** the team service generates it on first
> boot and persists it to `/data/secrets/upgrade-key` (a mounted volume), so it
> survives restarts. Read it with `daoctl credentials` (in `tools/`). If the
> organizer provisioned `GZCTF_UPGRADE_KEY`, that overrides the persisted key.
> This key — **not** your player key — owns the proxy admin, so it is the only
> credential that can repoint a proxy.

## Defense workflow

```sh
cd dist

# 1. Read the current state
./tools/daoctl info

# 2. Find a vulnerability in src/patchable/*.sol, patch it.
#    Keep the storage layout and legitimate behavior intact (upgrade-safe).

# 3. Build
forge build

# 4. Deploy V2 + repoint the proxy (your upgrade key)
./tools/daoctl upgrade <proxy> src/patchable/<Contract>.sol:<Contract>
```

Or manually:

```sh
forge create src/patchable/LendingVault.sol:LendingVault \
  --rpc-url $TEAM_RPC_URL --private-key $UPGRADE_KEY --broadcast

# OZ 4.9: your upgrade key IS the proxy admin
cast send $PROXY "upgradeTo(address)" $V2_ADDRESS \
  --rpc-url $TEAM_RPC_URL --private-key $UPGRADE_KEY --gas-limit 200000
```

## Attacking opponents (how you score)

You attack an opponent's **RPC endpoint** directly — there is no `/claim` on
the target. After exploiting, submit your proof to the **organizer verifier**:

```
exploit target /rpc
        │
        ▼
POST /claim to ORGANIZER VERIFIER  (not the target)
        │
        ▼
verifier checks on-chain state → releases the flag
```

```sh
cd solver
VERIFIER=http://<verifier>:9090 TEAM=<target-team> ./solve.sh http://<target-host>:8081 <your-player-key>
```

## Important

Patching the supporting infrastructure (the RPC gateway, Anvil, or the upgrade
mechanism itself) is out of scope — patching it breaks your SLA and/or your
upgrade path.
