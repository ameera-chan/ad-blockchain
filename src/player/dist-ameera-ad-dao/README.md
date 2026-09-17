# Player Guide

The service dashboard provides:

- `RPC_URL`
- `PROTOCOL_REGISTRY_ADDRESS`
- `WALLET_ADDRESS`

Use your GZCTF A&D SSH session to read your team credentials:

- `/data/private/PRIVKEY`
- `/data/private/UPGRADE_ADDR`
- `/data/private/UPGRADE_KEY`

Run the helper against a target service after your wallet has produced capture evidence:

```sh
export RPC_URL='http://TARGET_IP:TARGET_PORT/rpc'
./tools/daoctl.sh claim
```

The helper reads `/data/private/PRIVKEY`, requests a one-time claim message,
signs it, and submits the signature to the target. Set `PLAYER_KEY` when running
outside your team container.

## Build

```sh
forge build
```

## Deploy service updates

```sh
export RPC_URL='RPC_URL'
./tools/daoctl.sh upgrade <proxy-address> <contract-path>
```

The upgrade command reads `/data/private/UPGRADE_KEY`. Set `UPGRADE_KEY` when
running outside your team container.
