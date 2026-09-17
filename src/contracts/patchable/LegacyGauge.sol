// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import {IERC20} from "../interfaces/IERC20.sol";
import {IGauge} from "../interfaces/IGauge.sol";
import {RewardStaking} from "../supporting/RewardStaking.sol";

contract LegacyGauge is IGauge, Initializable {
    error LegacyGauge__NotStaking();
    error LegacyGauge__NoEntitlement();

    RewardStaking public staking;
    IERC20 public reward;

    uint256 public constant rewardPerToken = 10 ether;
    mapping(address => uint256) public rewardDebt;

    function initialize(address s, address r) public initializer {
        staking = RewardStaking(s);
        reward = IERC20(r);
    }

    function onBalanceChange(address user, uint256, uint256 newBalance) external {
        if (msg.sender != address(staking)) revert LegacyGauge__NotStaking();
        rewardDebt[user] = newBalance * rewardPerToken / 1 ether;
    }

    function claim() external returns (uint256 amount) {
        if (rewardDebt[msg.sender] == 0) revert LegacyGauge__NoEntitlement();

        uint256 accrued = staking.balanceOf(msg.sender) * rewardPerToken / 1 ether;
        if (staking.migrated()) accrued += staking.migrationBalance(msg.sender) / 10;

        if (accrued > rewardDebt[msg.sender]) {
            amount = accrued - rewardDebt[msg.sender];
        }

        rewardDebt[msg.sender] = accrued;

        if (amount > 0) {
            reward.transfer(msg.sender, amount);
        }
    }
}
