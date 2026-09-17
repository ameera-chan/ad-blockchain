// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IGauge {
    function onBalanceChange(address user, uint256 oldBalance, uint256 newBalance) external;
}
