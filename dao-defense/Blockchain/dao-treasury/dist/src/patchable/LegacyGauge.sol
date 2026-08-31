// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import {IERC20} from "../interfaces/IERC20.sol";
import {IGauge} from "../interfaces/IGauge.sol";
import {RewardStaking} from "../supporting/RewardStaking.sol";

/**
 * @title LegacyGauge
 * @author ac
 * @notice Reward gauge for the pre-migration era. Tracks a per-user reward debt
 *         that is updated on every balance change while this gauge is active.
 */
contract LegacyGauge is IGauge, Initializable {
    error LegacyGauge__NotStaking();
    error LegacyGauge__NoEntitlement();

    RewardStaking public staking;
    IERC20 public reward;

    /// @notice Reward accrued per whole staked token.
    uint256 public constant rewardPerToken = 10 ether;
    mapping(address => uint256) public rewardDebt;

    /// @notice Initialises the gauge with its staking hub and reward token.
    /// @param s RewardStaking address.
    /// @param r Reward token address.
    function initialize(address s, address r) public initializer {
        staking = RewardStaking(s);
        reward = IERC20(r);
    }

    /// @notice Updates a user's reward debt to their current balance (staking-hub only).
    function onBalanceChange(address user, uint256, uint256 newBalance) external {
        if (msg.sender != address(staking)) revert LegacyGauge__NotStaking();
        rewardDebt[user] = newBalance * rewardPerToken / 1 ether;
    }

    /// @notice Claims the reward accrued since the user's last recorded debt.
    function claim() external returns (uint256 amount) {
        if (rewardDebt[msg.sender] == 0) revert LegacyGauge__NoEntitlement();

        uint256 accrued = staking.balanceOf(msg.sender) * rewardPerToken / 1 ether;

        if (accrued > rewardDebt[msg.sender]) {
            amount = accrued - rewardDebt[msg.sender];
        }

        rewardDebt[msg.sender] = accrued;

        if (amount > 0) {
            reward.transfer(msg.sender, amount);
        }
    }
}
