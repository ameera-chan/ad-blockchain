// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "../interfaces/IERC20.sol";
import {IGauge} from "../interfaces/IGauge.sol";

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
    uint256 public migrationEpoch;
    mapping(address => uint256) private capturedEpoch;
    mapping(address => uint256) private capturedBalance;

    constructor(address t) {
        token = IERC20(t);
        owner = msg.sender;
    }

    function configureMigration(address oldG, address newG) external {
        if (msg.sender != owner || activeGauges.length != 0) revert RewardStaking__NotOwnerOrConfigured();

        oldGauge = oldG;
        migrationTarget = newG;
        activeGauges.push(oldG);
    }

    function finalizeMigration() external {
        if (migrated || oldGauge == address(0)) revert RewardStaking__MigrationNotReady();

        migrated = true;
        migrationEpoch += 1;
        delete activeGauges;
        activeGauges.push(migrationTarget);
    }

    function resetMigration() external {
        if (msg.sender != owner) revert RewardStaking__NotOwner();

        if (!migrated) {
            return;
        }

        migrated = false;
        delete activeGauges;
        activeGauges.push(oldGauge);
    }

    function stake(uint256 amount) external {
        uint256 old = balanceOf[msg.sender];
        _capture(msg.sender, old);

        token.transferFrom(msg.sender, address(this), amount);
        balanceOf[msg.sender] = old + amount;
        _sync(msg.sender, old, old + amount);
    }

    function withdraw(uint256 amount) external {
        uint256 old = balanceOf[msg.sender];
        _capture(msg.sender, old);
        if (old < amount) revert RewardStaking__InsufficientBalance();

        balanceOf[msg.sender] = old - amount;
        _sync(msg.sender, old, old - amount);
        token.transfer(msg.sender, amount);
    }

    function migrationBalance(address user) external view returns (uint256) {
        if (!migrated) return 0;
        return capturedEpoch[user] == migrationEpoch ? capturedBalance[user] : balanceOf[user];
    }

    function _capture(address user, uint256 oldBalance) private {
        if (migrated && capturedEpoch[user] != migrationEpoch) {
            capturedEpoch[user] = migrationEpoch;
            capturedBalance[user] = oldBalance;
        }
    }

    function _sync(address user, uint256 oldBalance, uint256 newBalance) internal {
        for (uint256 i; i < activeGauges.length; ++i) {
            (bool delivered,) = activeGauges[i].call(
                abi.encodeCall(IGauge.onBalanceChange, (user, oldBalance, newBalance))
            );
            if (!delivered) continue;
        }
    }
}
