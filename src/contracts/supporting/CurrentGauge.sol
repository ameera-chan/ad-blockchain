// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IGauge} from "../interfaces/IGauge.sol";

contract CurrentGauge is IGauge {
    error CurrentGauge__NotStaking();

    address public immutable staking;
    mapping(address => uint256) public observedBalance;

    constructor(address s) {
        staking = s;
    }

    function onBalanceChange(address user, uint256, uint256 newBalance) external {
        if (msg.sender != staking) revert CurrentGauge__NotStaking();
        observedBalance[user] = newBalance;
    }
}
