// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Pulls in the OpenZeppelin contracts the deployer needs as artifacts
// (standalone TimelockController + TransparentUpgradeableProxy). These aren't
// part of the challenge surface — they just ensure the compiler emits their
// bytecode/ABI for the deploy scripts.
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
