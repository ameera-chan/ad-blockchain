// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMigration {
    function migrated() external view returns (bool);
    function migrationEpoch() external view returns (uint256);
    function balanceAtTransition(address user) external view returns (uint256);
}
