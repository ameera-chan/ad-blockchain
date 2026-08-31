# DAO Treasury Defense — Player Kit

This is the Foundry project you patch and use to defend your own service. You
receive **source, tests, an upgrade script, and connection details** — the
exploitation (attacking other teams) is your own solver over their RPC.

## What you get from the challenge page

| Item | Where |
|---|---|
| Your RPC URL | `http://<team-ip>:8080` (or `/info`) |
| Chain ID | discoverable via `eth_chainId` |
| Contract / proxy addresses | `GET /info` (stable `ServiceProxy` addresses) |
| Your upgrade credential | team private key (authorizes the ProxyAdmin) |
| Full ABI / bytecode | `GET /artifact/<Name>` |

> **Where your upgrade key comes from:** the team service generates it on first
> boot and persists it to `/data/secrets/upgrade-key` (a mounted volume), so it
> survives restarts. Read it with `daoctl credentials` (in `tools/`). If the
> organizer provisioned `GZCTF_UPGRADE_KEY`, that overrides the persisted key.
> This key — **not** your player key — owns the proxy admin, so it is the only
> credential that can repoint a
> proxy.

## Layout

```text
player/
├── foundry.toml          Foundry config (solc 0.8.30, OZ remappings)
├── src/
│   ├── Token.sol          ERC-20 token + IERC20 interface
│   ├── AMM.sol            ConstantProductAMM
│   ├── Lending.sol        OracleHub + LendingVault
│   ├── Rewards.sol        RewardStaking + LegacyGauge + CurrentGauge
│   ├── Governance.sol     VoteMirror + GovStakingVault + RiskGovernor
│   └── Treasury.sol       Treasury
│   ← PATCH THESE (the vulnerable service)
├── script/
│   └── Upgrade.s.sol     deploy patched impl + repoint the proxy
├── test/
│   └── DaoDefense.t.sol  minimal functionality test
└── README.md
```

## One-time setup

```bash
forge install OpenZeppelin/openzeppelin-contracts@v4.9.6
forge install OpenZeppelin/openzeppelin-contracts-upgradeable@v4.9.6
forge install foundry-rs/forge-std
forge build
forge test
```

> **Remapping note:** `foundry.toml` maps `@openzeppelin/*/` to the **flattened**
> npm layout (`.sol` files directly at the package root). `forge install` clones
> the GitHub repos, where the OpenZeppelin sources live under a `contracts/`
> subdirectory — so change those two remappings to
> `lib/openzeppelin-contracts/contracts/` and
> `lib/openzeppelin-contracts-upgradeable/contracts/` respectively.

## Defense workflow (patch a vulnerability)

1. Edit the vulnerable contract in `src/` — fix the bug, keep the storage layout of the
   patched contract **unchanged** (proxies require storage-compatible upgrades;
   add new state only at the end, never reorder/remove existing variables).
2. `forge build` and `forge test` locally.
3. Deploy the patched implementation, then repoint the stable proxy at it
   (two steps — forge estimates gas for a script's transactions before the
   deploy lands, so the deploy + `upgradeTo` must be separate):

```bash
# 1. Deploy the patched V2 (note the "Deployed to:" address)
forge create src/Treasury.sol:Treasury \
  --rpc-url $TEAM_RPC_URL --private-key $UPGRADE_KEY --broadcast

# 2. Repoint the proxy (OZ 4.9: your upgrade key IS the proxy admin)
cast send $PROXY "upgradeTo(address)" $V2_ADDRESS \
  --rpc-url $TEAM_RPC_URL --private-key $UPGRADE_KEY --gas-limit 200000
```

(`script/Upgrade.s.sol` is the same two actions in one script; use it only if
your forge setup skips pre-broadcast gas estimation.)

The `ServiceProxy` address never changes; the checker keeps targeting it. Your
patch survives the per-round economic reset (the reset re-seeds balances, not
code).

## What NOT to patch

The infrastructure (`TransparentUpgradeableProxy`, `ProxyAdmin`, RPC gateway,
Anvil) is out of scope. Patching it breaks your SLA and/or your upgrade path —
same as tampering with the competition platform in a web A/D.

## Attack workflow (other teams)

Point your own Foundry/`cast`/solver at a target's RPC (`http://<team-ip>:8080`),
fund yourself via `POST /faucet`, exploit one of the five vulnerabilities, then
claim via the EIP-712 flow (`GET /claim-challenge` → sign → `POST /claim`). See
`solver/` for the official reference solver.
