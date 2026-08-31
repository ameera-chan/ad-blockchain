import secrets

from eth_abi import encode
from eth_account import Account
from eth_utils import keccak, to_checksum_address

from checker import Mumble, check


def body(response):
    try:
        return response.json()
    except ValueError:
        raise Mumble(f"non-JSON response: {response.status_code} {response.text[:80]!r}") from None


def rpc(target, method, params=None):
    response = target.request("POST", "/rpc", json={
        "jsonrpc": "2.0", "id": 1, "method": method, "params": params or []
    })
    data = body(response)
    if response.status_code != 200 or "error" in data:
        raise Mumble(f"{method} failed: {data.get('error', response.text[:80])}")
    return data.get("result")


def info(target):
    response = target.request("GET", "/info", timeout=30)
    data = body(response)
    if response.status_code != 200:
        raise Mumble(f"info returned {response.status_code}")
    required = {"chainId", "contracts", "victim", "vulnerabilities", "upgradeAddress"}
    if not required.issubset(data) or len(data["vulnerabilities"]) != 5:
        raise Mumble("info metadata is incomplete")
    return data


def fund(target, account):
    response = target.request("POST", "/faucet", json={"player": account.address}, timeout=30)
    data = body(response)
    if response.status_code != 200 or not data.get("funded"):
        raise Mumble("faucet did not fund the player")


def calldata(signature, types=(), values=()):
    return "0x" + (keccak(text=signature)[:4] + encode(types, values)).hex()


def send(target, info, account, to, data):
    nonce = int(rpc(target, "eth_getTransactionCount", [account.address, "pending"]), 16)
    gas_price = int(rpc(target, "eth_gasPrice"), 16)
    signed = account.sign_transaction({
        "chainId": info["chainId"], "nonce": nonce, "to": to_checksum_address(to),
        "value": 0, "gas": 1500000, "gasPrice": gas_price, "data": data,
    })
    raw = signed.raw_transaction.hex()
    raw = raw if raw.startswith("0x") else "0x" + raw
    tx_hash = rpc(target, "eth_sendRawTransaction", [raw])
    receipt = rpc(target, "eth_getTransactionReceipt", [tx_hash])
    if not receipt or int(receipt.get("status", "0x0"), 16) != 1:
        raise Mumble(f"legitimate transaction failed at {to} selector {data[:10]}: {tx_hash}")


def deploy(target, info, account, name, types=(), values=()):
    artifact = body(target.request("GET", f"/artifact/{name}"))
    creation = artifact["bytecode"] + encode(types, values).hex()
    nonce = int(rpc(target, "eth_getTransactionCount", [account.address, "pending"]), 16)
    gas_price = int(rpc(target, "eth_gasPrice"), 16)
    signed = account.sign_transaction({
        "chainId": info["chainId"], "nonce": nonce, "to": None,
        "value": 0, "gas": 8000000, "gasPrice": gas_price, "data": creation,
    })
    raw = signed.raw_transaction.hex()
    raw = raw if raw.startswith("0x") else "0x" + raw
    tx_hash = rpc(target, "eth_sendRawTransaction", [raw])
    receipt = rpc(target, "eth_getTransactionReceipt", [tx_hash])
    if not receipt or int(receipt.get("status", "0x0"), 16) != 1:
        raise Mumble(f"deploy {name} failed: {tx_hash}")
    return to_checksum_address(receipt["contractAddress"])


def call_uint(target, to, data):
    result = rpc(target, "eth_call", [{"to": to, "data": data}, "latest"])
    return int(result, 16)


@check
def health(target):
    response = target.request("GET", "/health")
    if response.status_code != 200 or response.text.strip() != "ok":
        raise Mumble(f"health returned {response.status_code} {response.text[:40]!r}")


@check
def info_and_rpc(target):
    player = Account.create()
    data = info(target)
    fund(target, player)

    rpc_data = rpc(target, "eth_chainId")
    if int(rpc_data, 16) != data["chainId"]:
        raise Mumble("RPC chain ID does not match info")
    blocked = target.request("POST", "/rpc", json={
        "jsonrpc": "2.0", "id": 2, "method": "evm_mine", "params": []
    })
    if body(blocked).get("error", {}).get("code") != -32601:
        raise Mumble("dangerous RPC method was not blocked")

    contracts = data["contracts"]
    amount = 10 * 10**18
    send(target, data, player, contracts["gov"], calldata(
        "approve(address,uint256)", ("address", "uint256"), (contracts["vault"], amount)
    ))
    send(target, data, player, contracts["vault"], calldata(
        "stake(uint256,address)", ("uint256", "address"), (amount, player.address)
    ))
    send(target, data, player, contracts["vault"], calldata(
        "withdraw(uint256)", ("uint256",), (amount,)
    ))
    staked = call_uint(target, contracts["vault"], calldata("staked(address)", ("address",), (player.address,)))
    if staked != 0:
        raise Mumble("legitimate full withdrawal did not clear stake")

    # Observer-failure withdrawal: deploy the checker's own probe and re-stake to it.
    probe = deploy(target, data, player, "DelegateProbe", ("address",), (player.address,))
    send(target, data, player, contracts["gov"], calldata(
        "approve(address,uint256)", ("address", "uint256"), (contracts["vault"], amount)
    ))
    send(target, data, player, contracts["vault"], calldata(
        "stake(uint256,address)", ("uint256", "address"), (amount, probe)
    ))
    send(target, data, player, probe, calldata("setFailNegative(bool)", ("bool",), (True,)))
    send(target, data, player, contracts["vault"], calldata("withdraw(uint256)", ("uint256",), (amount,)))
    if call_uint(target, contracts["vault"], calldata("staked(address)", ("address",), (player.address,))) != 0:
        raise Mumble("withdrawal failed when the observer was unavailable")

    small = 5 * 10**18
    send(target, data, player, contracts["lp"], calldata(
        "approve(address,uint256)", ("address", "uint256"), (contracts["rewardStaking"], small)
    ))
    send(target, data, player, contracts["rewardStaking"], calldata("stake(uint256)", ("uint256",), (small,)))
    send(target, data, player, contracts["rewardStaking"], calldata("withdraw(uint256)", ("uint256",), (small,)))

    send(target, data, player, contracts["treasury"], calldata("rebalance(uint256)", ("uint256",), (10**18,)))

    governance_stake = 100 * 10**18
    send(target, data, player, contracts["gov"], calldata(
        "approve(address,uint256)", ("address", "uint256"), (contracts["vault"], governance_stake)
    ))
    send(target, data, player, contracts["vault"], calldata(
        "stake(uint256,address)", ("uint256", "address"), (governance_stake, player.address)
    ))
    send(target, data, player, contracts["governor"], calldata(
        "proposeBatch(address[],uint256[])", ("address[]", "uint256[]"), ([player.address], [10 * 10**18])
    ))
    proposal_id = call_uint(target, contracts["governor"], calldata(
        "latestProposalId(address)", ("address",), (player.address,)
    ))
    send(target, data, player, contracts["governor"], calldata("castVote(uint256)", ("uint256",), (proposal_id,)))
    send(target, data, player, player.address, "0x")
    send(target, data, player, player.address, "0x")
    send(target, data, player, contracts["governor"], calldata("queueBatch(uint256)", ("uint256",), (proposal_id,)))
    send(target, data, player, contracts["governor"], calldata("executeBatch(uint256)", ("uint256",), (proposal_id,)))
    treasury_balance = call_uint(target, contracts["treasuryAsset"], calldata(
        "balanceOf(address)", ("address",), (player.address,)
    ))
    if treasury_balance != 10 * 10**18:
        raise Mumble("legitimate low-risk governance execution failed")


@check
def artifacts_and_claim_schema(target):
    player = "0x" + secrets.token_hex(20)
    data = info(target)
    artifact = target.request("GET", "/artifact/Token")
    artifact_data = body(artifact)
    if artifact.status_code != 200 or not artifact_data.get("abi") or not artifact_data.get("bytecode", "").startswith("0x"):
        raise Mumble("contract artifact endpoint is broken")
    challenge = target.request(
        "GET",
        "/claim-challenge",
        params={"player": player, "kind": "oracle", "proof": "0x" + "00" * 20},
    )
    claim = body(challenge)
    if challenge.status_code != 200 or not {"domain", "types", "value"}.issubset(claim):
        raise Mumble("EIP-712 claim challenge is incomplete")
    if claim["domain"].get("chainId") != data["chainId"]:
        raise Mumble("claim domain is not bound to the team chain")
