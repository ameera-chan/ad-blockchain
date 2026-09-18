# Player Guide

The service dashboard provides:

- `RPC_URL`
- `PROTOCOL_REGISTRY_ADDRESS`
- `WALLET_ADDRESS`

Use your GZCTF A&D SSH session to read your team credentials:

- `/data/private/PRIVKEY`
- `/data/private/UPGRADE_ADDR`
- `/data/private/UPGRADE_KEY`

## Fund your attack wallet

The faucet tops up the wallet with the funds needed to attack the target. Run this once per target and flag round:
```s
export RPC_URL='http://TARGET_IP:TARGET_PORT/rpc'
./tools/daoctl.sh faucet
```
Run the command against the target after you have compromised their wallet:

```sh
export RPC_URL='http://TARGET_IP:TARGET_PORT/rpc'
./tools/daoctl.sh claim
```
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
