// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Callback each active gauge implements so `RewardStaking` can notify it
///         of a user's balance change.
interface IGauge {
    function onBalanceChange(address user, uint256 oldBalance, uint256 newBalance) external;
}
