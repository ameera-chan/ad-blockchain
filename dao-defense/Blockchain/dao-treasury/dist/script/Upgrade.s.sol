// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {ITransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

// The patchable service. Edit src/*.sol, then run this script to deploy
// the patched implementation and repoint the (stable) proxy at it.
import {Treasury} from "../src/patchable/Treasury.sol";
import {LendingVault} from "../src/patchable/LendingVault.sol";
import {RiskGovernor} from "../src/patchable/RiskGovernor.sol";
import {VoteMirror} from "../src/patchable/VoteMirror.sol";
import {LegacyGauge} from "../src/patchable/LegacyGauge.sol";

// Usage (team upgrade credential = your private key):
//   forge script script/Upgrade.s.sol:Upgrade \
//     --rpc-url $TEAM_RPC_URL \
//     --private-key $UPGRADE_KEY \
//     --broadcast \
//     -e CONTRACT=Treasury \
//     -e PROXY=0x...   (stable proxy address from the challenge page)
//
// OZ 4.9's TransparentUpgradeableProxy stores the admin (your upgrade key)
// DIRECTLY in the ERC-1967 admin slot — there is no separate ProxyAdmin contract.
// So the upgrade is just `upgradeToAndCall` called by the upgrade key itself.
contract Upgrade is Script {
    function run() external {
        string memory name = vm.envString("CONTRACT");
        address proxy = vm.envAddress("PROXY");

        vm.startBroadcast();
        address implementation = deployImpl(name);
        ITransparentUpgradeableProxy(proxy).upgradeTo(implementation);
        vm.stopBroadcast();
    }

    function deployImpl(string memory name) internal returns (address) {
        if (keccak256(bytes(name)) == keccak256("Treasury")) return address(new Treasury());
        if (keccak256(bytes(name)) == keccak256("LendingVault")) return address(new LendingVault());
        if (keccak256(bytes(name)) == keccak256("RiskGovernor")) return address(new RiskGovernor());
        if (keccak256(bytes(name)) == keccak256("VoteMirror")) return address(new VoteMirror());
        if (keccak256(bytes(name)) == keccak256("LegacyGauge")) return address(new LegacyGauge());
        revert("unknown CONTRACT (one of Treasury, LendingVault, RiskGovernor, VoteMirror, LegacyGauge)");
    }
}
