// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "../interfaces/IERC20.sol";
import {VoteMirror} from "../patchable/VoteMirror.sol";

contract GovStakingVault {
    error GovStakingVault__InvalidStake();
    error GovStakingVault__DelegateLocked();
    error GovStakingVault__SyncFailed();
    error GovStakingVault__InsufficientStake();

    IERC20 public immutable token;
    VoteMirror public immutable mirror;

    mapping(address => uint256) public staked;
    mapping(address => address) public delegateOf;

    constructor(address token_, address mirror_) {
        token = IERC20(token_);
        mirror = VoteMirror(mirror_);
    }

    function stake(uint256 amount, address delegatee) external {
        if (amount == 0 || delegatee == address(0)) revert GovStakingVault__InvalidStake();
        if (staked[msg.sender] != 0 && delegateOf[msg.sender] != delegatee) {
            revert GovStakingVault__DelegateLocked();
        }

        token.transferFrom(msg.sender, address(this), amount);
        staked[msg.sender] += amount;
        delegateOf[msg.sender] = delegatee;

        if (!mirror.sync(delegatee, int256(amount))) revert GovStakingVault__SyncFailed();
    }

    function withdraw(uint256 amount) external {
        if (staked[msg.sender] < amount) revert GovStakingVault__InsufficientStake();

        staked[msg.sender] -= amount;
        mirror.sync(delegateOf[msg.sender], -int256(amount));
        token.transfer(msg.sender, amount);
    }
}
