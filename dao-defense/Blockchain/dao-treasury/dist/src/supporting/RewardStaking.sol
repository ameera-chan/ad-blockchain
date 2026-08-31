// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "../interfaces/IERC20.sol";
import {IGauge} from "../interfaces/IGauge.sol";

/**
 * @title RewardStaking
 * @author ac
 * @notice Staking hub that fans balance-change notifications out to one or more
 *         gauges. Supports a one-shot gauge migration (legacy → current).
 */
contract RewardStaking {
    error RewardStaking__NotOwner();
    error RewardStaking__NotOwnerOrConfigured();
    error RewardStaking__MigrationNotReady();
    error RewardStaking__InsufficientBalance();

    IERC20 public immutable token;
    address public immutable owner;

    mapping(address => uint256) public balanceOf;

    address[] public activeGauges;
    address public oldGauge;
    address public migrationTarget;
    bool public migrated;

    /// @notice Deploys the staking hub and records the owner.
    /// @param t Staked token address.
    constructor(address t) {
        token = IERC20(t);
        owner = msg.sender;
    }

    /// @notice Configures the one-shot gauge migration before any stake occurs.
    /// @param oldG Legacy gauge being retired.
    /// @param newG New gauge taking over.
    function configureMigration(address oldG, address newG) external {
        if (msg.sender != owner || activeGauges.length != 0) revert RewardStaking__NotOwnerOrConfigured();

        oldGauge = oldG;
        migrationTarget = newG;
        activeGauges.push(oldG);
    }

    /// @notice Switches the active gauge from the legacy to the migration target.
    function finalizeMigration() external {
        if (migrated || oldGauge == address(0)) revert RewardStaking__MigrationNotReady();

        migrated = true;
        delete activeGauges;
        activeGauges.push(migrationTarget);
    }

    /// @notice Admin-only rollback that restores the pre-migration gauge set.
    function resetMigration() external {
        if (msg.sender != owner) revert RewardStaking__NotOwner();

        if (!migrated) {
            return;
        }

        migrated = false;
        delete activeGauges;
        activeGauges.push(oldGauge);
    }

    /// @notice Stakes `amount`, then notifies every active gauge of the new balance.
    function stake(uint256 amount) external {
        uint256 old = balanceOf[msg.sender];

        token.transferFrom(msg.sender, address(this), amount);
        balanceOf[msg.sender] = old + amount;
        _sync(msg.sender, old, old + amount);
    }

    /// @notice Withdraws `amount`, then notifies every active gauge of the new balance.
    function withdraw(uint256 amount) external {
        uint256 old = balanceOf[msg.sender];
        if (old < amount) revert RewardStaking__InsufficientBalance();

        balanceOf[msg.sender] = old - amount;
        _sync(msg.sender, old, old - amount);
        token.transfer(msg.sender, amount);
    }

    /// @dev Fans a balance-change notification out to each active gauge.
    function _sync(address user, uint256 oldBalance, uint256 newBalance) internal {
        for (uint256 i; i < activeGauges.length; ++i) {
            activeGauges[i].call(
                abi.encodeCall(IGauge.onBalanceChange, (user, oldBalance, newBalance))
            );
        }
    }
}
