// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IGauge} from "./IGauge.sol";

contract RewardGaugeV2 is IGauge {
    error RewardGaugeV2__NotStaking();

    address public immutable staking;
    mapping(address => uint256) public observedBalance;

    constructor(address staking_) {
        staking = staking_;
    }

    function onBalanceChange(address user, uint256, uint256 newBalance) external {
        if (msg.sender != staking) revert RewardGaugeV2__NotStaking();
        observedBalance[user] = newBalance;
    }
}
