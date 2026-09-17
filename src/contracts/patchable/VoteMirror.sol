// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Checkpoints} from "@openzeppelin/contracts/utils/Checkpoints.sol";
import {IVotesUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/utils/IVotesUpgradeable.sol";

contract VoteMirror is IVotesUpgradeable, Initializable {
    using Checkpoints for Checkpoints.Trace224;

    error VoteMirror__NotOwner();
    error VoteMirror__NotOwnerOrVaultSet();
    error VoteMirror__NotVault();
    error VoteMirror__FutureLookup();
    error VoteMirror__VaultDelegationOnly();

    address public owner;
    address public vault;

    uint256 public syncAttemptsFailed;

    mapping(address => uint256) public votes;
    mapping(address => Checkpoints.Trace224) private voteCheckpoints;
    Checkpoints.Trace224 private supplyCheckpoints;

    function initialize() public initializer {
        owner = msg.sender;
    }

    function setVault(address vault_) external {
        if (msg.sender != owner || vault != address(0)) revert VoteMirror__NotOwnerOrVaultSet();
        vault = vault_;
    }

    function resetDiagnostics() external {
        if (msg.sender != owner) revert VoteMirror__NotOwner();
        syncAttemptsFailed = 0;
    }

    function sync(address delegatee, int256 delta) external returns (bool) {
        if (msg.sender != vault) revert VoteMirror__NotVault();

        (bool ok,) = delegatee.call(abi.encodeWithSignature("onVoteSync(int256)", delta));
        if (!ok) {
            syncAttemptsFailed += 1;
            return false;
        }

        uint256 oldVotes = votes[delegatee];
        uint256 oldSupply = supplyCheckpoints.latest();

        if (delta >= 0) {
            votes[delegatee] = oldVotes + uint256(delta);
            supplyCheckpoints.push(
                uint32(block.number),
                uint224(oldSupply + uint256(delta))
            );
        } else {
            votes[delegatee] = oldVotes - uint256(-delta);
            supplyCheckpoints.push(
                uint32(block.number),
                uint224(oldSupply - uint256(-delta))
            );
        }

        voteCheckpoints[delegatee].push(uint32(block.number), uint224(votes[delegatee]));
        emit DelegateVotesChanged(delegatee, oldVotes, votes[delegatee]);
        return true;
    }

    function getVotes(address account) external view returns (uint256) {
        return votes[account];
    }

    function getPastVotes(address account, uint256 timepoint) external view returns (uint256) {
        if (timepoint >= block.number) revert VoteMirror__FutureLookup();
        return voteCheckpoints[account].upperLookupRecent(uint32(timepoint));
    }

    function getPastTotalSupply(uint256 timepoint) external view returns (uint256) {
        if (timepoint >= block.number) revert VoteMirror__FutureLookup();
        return supplyCheckpoints.upperLookupRecent(uint32(timepoint));
    }

    function delegates(address account) external pure returns (address) {
        return account;
    }

    function delegate(address) external pure {
        revert VoteMirror__VaultDelegationOnly();
    }

    function delegateBySig(
        address,
        uint256,
        uint256,
        uint8,
        bytes32,
        bytes32
    ) external pure {
        revert VoteMirror__VaultDelegationOnly();
    }
}
