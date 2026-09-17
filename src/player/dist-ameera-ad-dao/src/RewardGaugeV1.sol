// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import {IERC20} from "./IERC20.sol";
import {IGauge} from "./IGauge.sol";
import {RewardStaking} from "./RewardStaking.sol";

contract RewardGaugeV1 is IGauge, Initializable {
    error RewardGaugeV1__NotStaking();
    error RewardGaugeV1__NoEntitlement();

    RewardStaking public staking;
    IERC20 public reward;

    uint256 public constant rewardPerToken = 10 ether;
    mapping(address => uint256) public rewardDebt;

    function initialize(address staking_, address rewardToken_) public initializer {
        staking = RewardStaking(staking_);
        reward = IERC20(rewardToken_);
    }

    function onBalanceChange(address user, uint256, uint256 newBalance) external {
        if (msg.sender != address(staking)) revert RewardGaugeV1__NotStaking();
        rewardDebt[user] = newBalance * rewardPerToken / 1 ether;
    }

    function claim() external returns (uint256 amount) {
        if (rewardDebt[msg.sender] == 0) revert RewardGaugeV1__NoEntitlement();

        uint256 accrued = staking.balanceOf(msg.sender) * rewardPerToken / 1 ether;
        if (staking.migrated()) accrued += staking.balanceAtTransition(msg.sender) / 10;

        if (accrued > rewardDebt[msg.sender]) {
            amount = accrued - rewardDebt[msg.sender];
        }

        rewardDebt[msg.sender] = accrued;

        if (amount > 0) {
            reward.transfer(msg.sender, amount);
        }
    }
}
