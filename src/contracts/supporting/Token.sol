// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IMigration} from "../interfaces/IMigration.sol";
import {IERC20} from "../interfaces/IERC20.sol";

contract Token is IERC20 {
    error Token__NotOwner();
    error Token__InsufficientAllowance();
    error Token__InsufficientBalance();
    error Token__RewardsConfigured();

    string public name;
    string public symbol;
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    address public immutable owner;

    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public grantIssued;
    mapping(address => mapping(address => uint256)) public transferVolume;
    address public rewardPool;
    IMigration public rewardStaking;
    mapping(uint256 => mapping(address => uint256)) private bonusPaid;
    mapping(address => uint256) public rewardAdjustment;

    function configureRewards(address rewardPool_, address staking_) external {
        if (msg.sender != owner) revert Token__NotOwner();
        if (rewardPool != address(0)) revert Token__RewardsConfigured();
        rewardPool = rewardPool_;
        rewardStaking = IMigration(staking_);
    }

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
        owner = msg.sender;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != owner) revert Token__NotOwner();
        _mint(to, amount);
    }

    function grant(address to, uint256 amount) external {
        if (msg.sender != owner) revert Token__NotOwner();
        if (grantIssued[to]) return;
        grantIssued[to] = true;
        _mint(to, amount);
    }

    function _mint(address to, uint256 amount) private {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function burn(address from, uint256 amount) external {
        if (msg.sender != owner) revert Token__NotOwner();
        if (balanceOf[from] < amount) revert Token__InsufficientBalance();
        balanceOf[from] -= amount;
        totalSupply -= amount;
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a < amount) revert Token__InsufficientAllowance();

        if (a != type(uint256).max) {
            allowance[from][msg.sender] = a - amount;
        }

        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (balanceOf[from] < amount) revert Token__InsufficientBalance();
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        transferVolume[from][to] += amount;
        if (from == rewardPool && amount > 0) {
            uint256 allowed;
            uint256 epoch = rewardStaking.migrationEpoch();
            if (rewardStaking.migrated()) allowed = rewardStaking.balanceAtTransition(to) / 10;
            uint256 paid = bonusPaid[epoch][to];
            uint256 remaining = allowed > paid ? allowed - paid : 0;
            if (amount > remaining) rewardAdjustment[to] += amount - remaining;
            bonusPaid[epoch][to] = paid + amount;
        }
    }
}
