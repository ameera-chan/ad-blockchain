import re
import secrets
import json
import hashlib
from pathlib import Path

from checker import Mumble, check


ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
ZERO_ADDRESS = "0x" + "0" * 40
ETHER = 10**18
MAX_RPC_BATCH = 20
IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"

SELECTOR = {
    "reference_borrower": "0x4d9e6e9d",
    "lending": "0xcb8c5a3a",
    "gauge_v1": "0xdcafea1e",
    "risk": "0x93cd5556",
    "mirror": "0x9844841a",
    "treasury": "0x79022a9f",
    "owner": "0x8da5cb5b",
    "collateral_token": "0xb2016bd4",
    "debt_token": "0xf8d89898",
    "oracle": "0x7dc0d1d0",
    "positions": "0x55f57510",
    "liquidate": "0x0710285c",
    "staking": "0x4cf088d9",
    "reward": "0x228cb733",
    "reward_per_token": "0xcd3daf9d",
    "treasury_ref": "0x61d027b3",
    "treasury_token": "0xb2ce514b",
    "review_threshold": "0x57825849",
    "quorum": "0xf8ce560a",
    "voting_delay": "0x3932abb1",
    "voting_period": "0x02a251a3",
    "vault": "0xfbfa77cf",
    "sync_attempts_failed": "0x708a3b66",
    "governor": "0x0c340a24",
    "amm": "0x2a943945",
    "rebalance_token": "0x0a6c5a92",
    "settlement_token": "0x7b9e618d",
    "last_rebalance_amount": "0xb6086566",
    "last_rebalance_output": "0x7892badd",
    "token": "0xfc0c546a",
    "mirror_ref": "0x444d9172",
    "previous_gauge": "0xc5d5ce7d",
    "next_gauge": "0x71304ed3",
    "migrated": "0x2c678c64",
    "balance_of": "0x70a08231",
    "token0": "0x0dfe1681",
    "token1": "0xd21220a7",
    "reserve0": "0x443cb4bc",
    "reserve1": "0x5a76f25e",
    "distribute": "0xa16a9183",
    "configure_rebalance": "0x26ab4319",
    "reset_rebalance": "0x9b88cabf",
    "seed": "0x96546dca",
    "sync": "0xaed625b1",
    "reset_diagnostics": "0xe21d09ba",
    "balance_change": "0x720ea645",
    "rebalance": "0xf4993018",
    "propose_batch": "0xa93830e8",
}


def json_response(response, expected=200):
    if response.status_code != expected:
        raise Mumble(f"HTTP {response.status_code}, expected {expected}")
    try:
        return response.json()
    except ValueError as error:
        raise Mumble("invalid JSON response") from error


def rpc_raw(target, method, params):
    body = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    return json_response(target.request("POST", "/rpc", json=body))


def rpc(target, method, params):
    data = rpc_raw(target, method, params)
    if "error" in data or "result" not in data:
        raise Mumble(f"RPC {method} failed")
    return data["result"]


def rpc_batch_raw(target, calls):
    ordered = []
    for offset in range(0, len(calls), MAX_RPC_BATCH):
        chunk = calls[offset:offset + MAX_RPC_BATCH]
        payload = [
            {"jsonrpc": "2.0", "id": index, "method": method, "params": params}
            for index, (method, params) in enumerate(chunk, 1)
        ]
        data = json_response(target.request("POST", "/rpc", json=payload))
        if not isinstance(data, list):
            raise Mumble("RPC batch returned an invalid response")
        replies = {item.get("id"): item for item in data if isinstance(item, dict)}
        if any(request["id"] not in replies for request in payload):
            raise Mumble("RPC batch omitted a response")
        ordered.extend(replies[request["id"]] for request in payload)
    return ordered


def rpc_batch(target, calls):
    replies = rpc_batch_raw(target, calls)
    results = []
    for reply, (method, _) in zip(replies, calls):
        if "error" in reply or "result" not in reply:
            raise Mumble(f"RPC {method} failed")
        results.append(reply["result"])
    return results


def self_info(target):
    cached = getattr(target, "_self_info", None)
    if cached is None:
        cached = json_response(target.request("GET", "/self-info"))
        target._self_info = cached
    return cached


def uint_word(value):
    return f"{value % (1 << 256):064x}"


def address_word(value):
    if not ADDRESS.fullmatch(value):
        raise Mumble("invalid contract address")
    return value[2:].lower().rjust(64, "0")


def calldata(selector, *words):
    return selector + "".join(words)


def call(to, data, sender=None):
    transaction = {"to": to, "data": data}
    if sender:
        transaction["from"] = sender
    return "eth_call", [transaction, "latest"]


def decode_words(value, minimum=1):
    if not isinstance(value, str) or not value.startswith("0x"):
        raise Mumble("contract returned malformed data")
    payload = value[2:]
    if len(payload) < minimum * 64 or len(payload) % 64:
        raise Mumble("contract returned malformed data")
    return [int(payload[index:index + 64], 16) for index in range(0, len(payload), 64)]


def decode_address(value, index=0):
    words = decode_words(value, index + 1)
    return f"0x{words[index] & ((1 << 160) - 1):040x}"


def decode_uint(value, index=0):
    return decode_words(value, index + 1)[index]


def ensure_nonzero_addresses(values):
    if any(not ADDRESS.fullmatch(value) or value.lower() == ZERO_ADDRESS for value in values):
        raise Mumble("contract topology contains an invalid address")


def require_code(target, addresses):
    unique = list(dict.fromkeys(address.lower() for address in addresses))
    code = rpc_batch(target, [("eth_getCode", [address, "latest"]) for address in unique])
    if any(not isinstance(value, str) or len(value) <= 4 for value in code):
        raise Mumble("contract topology contains an empty implementation")


@check
def public_service(target):
    health = target.request("GET", "/health")
    if health.status_code != 200 or health.text.strip() != "ok":
        raise Mumble("health endpoint is invalid")

    info = self_info(target)
    if info.get("rpcUrl") != "/rpc":
        raise Mumble("invalid RPC information")
    if not ADDRESS.fullmatch(info.get("registryContract", "")):
        raise Mumble("invalid protocol registry")
    if not ADDRESS.fullmatch(info.get("playerAddress", "")):
        raise Mumble("invalid wallet information")

    forbidden = {
        "privateKey", "playerPrivateKey", "upgradeAddress", "upgradeKey",
        "upgradePrivateKey", "PRIVKEY", "UPGRADE_ADDR", "UPGRADE_KEY",
    }
    if forbidden.intersection(info):
        raise Mumble("public service exposed private credentials")

    for path in ("/info", "/private-info"):
        if target.request("GET", path).status_code != 404:
            raise Mumble("removed endpoint is still exposed")


@check
def contract_integrity(target):
    registry = self_info(target)["registryContract"]
    registry_names = ("reference_borrower", "lending", "gauge_v1", "risk", "mirror", "treasury")
    registry_values = rpc_batch(target, [call(registry, SELECTOR[name]) for name in registry_names])
    topology = dict(zip(registry_names, (decode_address(value) for value in registry_values)))

    ensure_nonzero_addresses(topology.values())
    contracts = [topology[name] for name in registry_names if name != "reference_borrower"]
    if len({address.lower() for address in contracts}) != len(contracts):
        raise Mumble("contract registry contains duplicate entries")
    require_code(target, [registry, *contracts])

    implementation_values = rpc_batch(target, [
        ("eth_getStorageAt", [topology[name], IMPLEMENTATION_SLOT, "latest"])
        for name in ("lending", "gauge_v1", "risk", "mirror", "treasury")
    ])
    implementations = [decode_address(value) for value in implementation_values]
    target._implementations = dict(zip(("lending", "gauge_v1", "risk", "mirror", "treasury"), implementations))
    ensure_nonzero_addresses(implementations)
    require_code(target, implementations)

    borrower_arg = address_word(topology["reference_borrower"])
    specs = (
        ("treasury_owner", topology["treasury"], SELECTOR["owner"]),
        ("treasury_governor", topology["treasury"], SELECTOR["governor"]),
        ("amm", topology["treasury"], SELECTOR["amm"]),
        ("rebalance_token", topology["treasury"], SELECTOR["rebalance_token"]),
        ("settlement_token", topology["treasury"], SELECTOR["settlement_token"]),
        ("last_rebalance_amount", topology["treasury"], SELECTOR["last_rebalance_amount"]),
        ("last_rebalance_output", topology["treasury"], SELECTOR["last_rebalance_output"]),
        ("lending_owner", topology["lending"], SELECTOR["owner"]),
        ("collateral_token", topology["lending"], SELECTOR["collateral_token"]),
        ("debt_token", topology["lending"], SELECTOR["debt_token"]),
        ("oracle", topology["lending"], SELECTOR["oracle"]),
        ("position", topology["lending"], calldata(SELECTOR["positions"], borrower_arg)),
        ("gauge_staking", topology["gauge_v1"], SELECTOR["staking"]),
        ("reward_token", topology["gauge_v1"], SELECTOR["reward"]),
        ("reward_rate", topology["gauge_v1"], SELECTOR["reward_per_token"]),
        ("governor_treasury", topology["risk"], SELECTOR["treasury_ref"]),
        ("treasury_token", topology["risk"], SELECTOR["treasury_token"]),
        ("review_threshold", topology["risk"], SELECTOR["review_threshold"]),
        ("quorum", topology["risk"], calldata(SELECTOR["quorum"], uint_word(0))),
        ("voting_delay", topology["risk"], SELECTOR["voting_delay"]),
        ("voting_period", topology["risk"], SELECTOR["voting_period"]),
        ("mirror_owner", topology["mirror"], SELECTOR["owner"]),
        ("vault", topology["mirror"], SELECTOR["vault"]),
        ("sync_attempts_failed", topology["mirror"], SELECTOR["sync_attempts_failed"]),
    )
    replies = rpc_batch(target, [call(address, data) for _, address, data in specs])
    state = dict(zip((name for name, _, _ in specs), replies))

    address_keys = (
        "treasury_owner", "treasury_governor", "amm", "rebalance_token", "settlement_token",
        "lending_owner", "collateral_token", "debt_token", "oracle", "gauge_staking",
        "reward_token", "governor_treasury", "treasury_token", "mirror_owner", "vault",
    )
    addresses = {key: decode_address(state[key]) for key in address_keys}
    ensure_nonzero_addresses(addresses.values())
    if addresses["governor_treasury"].lower() != topology["treasury"].lower():
        raise Mumble("governance topology is inconsistent")

    position = decode_words(state["position"], 3)
    if position[:3] != [100 * ETHER, 80 * ETHER, 1]:
        raise Mumble("lending state is inconsistent")
    if decode_uint(state["reward_rate"]) != 10 * ETHER:
        raise Mumble("staking configuration is inconsistent")
    if decode_uint(state["review_threshold"]) != 500 * ETHER:
        raise Mumble("governance configuration is inconsistent")
    if decode_uint(state["quorum"]) != 100 * ETHER:
        raise Mumble("governance quorum is inconsistent")
    if decode_uint(state["voting_delay"]) != 0 or decode_uint(state["voting_period"]) != 2:
        raise Mumble("governance timing is inconsistent")

    secondary_specs = (
        ("vault_token", addresses["vault"], SELECTOR["token"]),
        ("vault_mirror", addresses["vault"], SELECTOR["mirror_ref"]),
        ("staking_token", addresses["gauge_staking"], SELECTOR["token"]),
        ("previous_gauge", addresses["gauge_staking"], SELECTOR["previous_gauge"]),
        ("next_gauge", addresses["gauge_staking"], SELECTOR["next_gauge"]),
        ("migrated", addresses["gauge_staking"], SELECTOR["migrated"]),
        ("amm_token0", addresses["amm"], SELECTOR["token0"]),
        ("amm_token1", addresses["amm"], SELECTOR["token1"]),
        ("reserve0", addresses["amm"], SELECTOR["reserve0"]),
        ("reserve1", addresses["amm"], SELECTOR["reserve1"]),
        ("reward_reserve", addresses["reward_token"], calldata(SELECTOR["balance_of"], address_word(topology["gauge_v1"]))),
        ("treasury_reserve", addresses["treasury_token"], calldata(SELECTOR["balance_of"], address_word(topology["treasury"]))),
    )
    replies = rpc_batch(target, [call(address, data) for _, address, data in secondary_specs])
    secondary = dict(zip((name for name, _, _ in secondary_specs), replies))

    secondary_addresses = {
        key: decode_address(secondary[key])
        for key in ("vault_token", "vault_mirror", "staking_token", "previous_gauge", "next_gauge", "amm_token0", "amm_token1")
    }
    ensure_nonzero_addresses(secondary_addresses.values())
    if secondary_addresses["vault_mirror"].lower() != topology["mirror"].lower():
        raise Mumble("voting topology is inconsistent")
    if secondary_addresses["previous_gauge"].lower() != topology["gauge_v1"].lower():
        raise Mumble("staking topology is inconsistent")
    amm_tokens = {secondary_addresses["amm_token0"].lower(), secondary_addresses["amm_token1"].lower()}
    expected_amm_tokens = {addresses["rebalance_token"].lower(), addresses["settlement_token"].lower()}
    if amm_tokens != expected_amm_tokens:
        raise Mumble("treasury market configuration is inconsistent")
    if decode_uint(secondary["reserve0"]) == 0 or decode_uint(secondary["reserve1"]) == 0:
        raise Mumble("treasury market has no liquidity")
    if decode_uint(secondary["treasury_reserve"]) < 9000 * ETHER:
        raise Mumble("treasury reserve is unhealthy")

    require_code(target, [
        addresses["treasury_governor"], addresses["amm"], addresses["rebalance_token"],
        addresses["settlement_token"], addresses["collateral_token"], addresses["debt_token"],
        addresses["oracle"], addresses["gauge_staking"], addresses["reward_token"],
        addresses["treasury_token"], addresses["vault"], secondary_addresses["vault_token"],
        secondary_addresses["staking_token"], secondary_addresses["next_gauge"],
    ])

    target._topology = {**topology, **addresses, **secondary_addresses}


@check
def contract_behavior(target):
    topology = getattr(target, "_topology", None)
    if not topology:
        raise Mumble("contract topology is unavailable")

    actor = "0x" + secrets.token_hex(20)
    actor_arg = address_word(actor)
    operations = (
        (topology["treasury"], calldata(SELECTOR["distribute"], address_word(topology["treasury_token"]), actor_arg, uint_word(1)), topology["treasury_governor"]),
        (topology["treasury"], calldata(SELECTOR["configure_rebalance"], address_word(topology["amm"]), address_word(topology["rebalance_token"]), address_word(topology["settlement_token"])), topology["treasury_owner"]),
        (topology["treasury"], SELECTOR["reset_rebalance"], topology["treasury_owner"]),
        (topology["lending"], calldata(SELECTOR["seed"], actor_arg, uint_word(1), uint_word(1)), topology["lending_owner"]),
        (topology["mirror"], calldata(SELECTOR["sync"], actor_arg, uint_word(1)), topology["vault"]),
        (topology["mirror"], SELECTOR["reset_diagnostics"], topology["mirror_owner"]),
        (topology["gauge_v1"], calldata(SELECTOR["balance_change"], actor_arg, uint_word(0), uint_word(1)), topology["gauge_staking"]),
    )

    unauthorized = rpc_batch_raw(target, [call(address, data, actor) for address, data, _ in operations])
    if any("error" not in reply for reply in unauthorized):
        raise Mumble("contract access policy is invalid")

    authorized = rpc_batch_raw(target, [call(address, data, sender) for address, data, sender in operations])
    if any("error" in reply or "result" not in reply for reply in authorized):
        raise Mumble("authorized contract operation failed")
    if decode_uint(authorized[4]["result"]) != 1:
        raise Mumble("vote synchronization returned an invalid result")

    public_calls = [
        call(topology["treasury"], calldata(SELECTOR["rebalance"], uint_word(ETHER)), actor),
        call(topology["risk"], calldata(
            SELECTOR["propose_batch"],
            uint_word(64), uint_word(128),
            uint_word(1), actor_arg,
            uint_word(1), uint_word(1),
        ), actor),
    ]
    public_results = rpc_batch(target, public_calls)
    if decode_uint(public_results[0]) == 0 or decode_uint(public_results[1]) == 0:
        raise Mumble("public contract operation returned an invalid result")

    healthy_liquidation = calldata(
        SELECTOR["liquidate"], address_word(topology["reference_borrower"]), uint_word(1), uint_word(1)
    )
    reply = rpc_batch_raw(target, [call(topology["lending"], healthy_liquidation, actor)])[0]
    if "error" not in reply:
        raise Mumble("lending health policy is invalid")


@check
def service_status(target):
    body = json_response(target.request("GET", "/status"))
    if body.get("ready") is not True or not isinstance(body.get("blockNumber"), int):
        raise Mumble("service status is invalid")


@check
def stateful_functionality(target):
    implementations = getattr(target, "_implementations", None)
    if not implementations:
        raise Mumble("implementations unavailable")
    probes = json.loads(Path(__file__).with_name("probes.json").read_text())
    for name, contract in (("LendingProbe", "lending"), ("RewardProbe", "gauge_v1"),
                           ("VoteProbe", "mirror"), ("TreasuryProbe", "treasury"),
                           ("GovernanceProbe", "risk")):
        data = probes[name] + address_word(implementations[contract]) + uint_word(10 + secrets.randbelow(10))
        result = rpc(target, "eth_call", [{"data": data, "gas": hex(20_000_000)}, "latest"])
        if result != "0x" + uint_word(1):
            raise Mumble(f"{name} failed")


@check
def funding(target):
    topology = getattr(target, "_topology", None)
    if not topology:
        raise Mumble("contract topology is unavailable")

    registry = self_info(target)["registryContract"].lower().encode()
    player = "0x" + hashlib.sha256(registry + b":checker-faucet").hexdigest()[-40:]
    result = json_response(target.request("POST", "/faucet", json={"player": player}))
    if result.get("player", "").lower() != player.lower():
        raise Mumble("faucet returned the wrong address")

    token_addresses = (
        topology["vault_token"], topology["debt_token"],
        topology["staking_token"], topology["rebalance_token"],
    )
    calls = [("eth_getBalance", [player, "latest"])] + [
        call(token, calldata(SELECTOR["balance_of"], address_word(player)))
        for token in token_addresses
    ]
    balances = rpc_batch(target, calls)
    if int(balances[0], 16) == 0 or any(decode_uint(value) == 0 for value in balances[1:]):
        raise Mumble("faucet did not provide the expected assets")
