// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IGauge} from "../interfaces/IGauge.sol";

/**
 * @title CurrentGauge
 * @author ac
 * @notice Replacement gauge that simply mirrors each user's latest observed balance.
 */
contract CurrentGauge is IGauge {
    error CurrentGauge__NotStaking();

    address public immutable staking;
    mapping(address => uint256) public observedBalance;

    /// @notice Deploys the gauge and records the staking hub.
    /// @param s RewardStaking address.
    constructor(address s) {
        staking = s;
    }

    /// @notice Records the user's latest balance (staking-hub only).
    function onBalanceChange(address user, uint256, uint256 newBalance) external {
        if (msg.sender != staking) revert CurrentGauge__NotStaking();
        observedBalance[user] = newBalance;
    }
}
