// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Checkpoints} from "@openzeppelin/contracts/utils/Checkpoints.sol";
import {IVotesUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/utils/IVotesUpgradeable.sol";

/**
 * @title VoteMirror
 * @author ac
 * @notice IVotes-compatible vote ledger fed by the staking vault. Each delegatee's
 *         voting weight is the staked balance the vault has assigned to them.
 */
contract VoteMirror is IVotesUpgradeable, Initializable {
    using Checkpoints for Checkpoints.Trace224;

    error VoteMirror__NotOwnerOrVaultSet();
    error VoteMirror__NotVault();
    error VoteMirror__FutureLookup();
    error VoteMirror__VaultDelegationOnly();

    address public owner;
    address public vault;

    mapping(address => uint256) public votes;
    mapping(address => Checkpoints.Trace224) private voteCheckpoints;
    Checkpoints.Trace224 private supplyCheckpoints;

    /// @notice Initialises ownership to the deployer (called once by the proxy).
    function initialize() public initializer {
        owner = msg.sender;
    }

    /// @notice Sets the staking vault (once).
    function setVault(address v) external {
        if (msg.sender != owner || vault != address(0)) revert VoteMirror__NotOwnerOrVaultSet();
        vault = v;
    }

    /// @notice Applies a signed vote delta to `delegatee`. Staking-vault only.
    /// @param delegatee Account whose voting weight changes.
    /// @param delta     Signed change in voting weight.
    function sync(address delegatee, int256 delta) external returns (bool) {
        if (msg.sender != vault) revert VoteMirror__NotVault();

        (bool ok,) = delegatee.call(abi.encodeWithSignature("onVoteSync(int256)", delta));
        if (!ok) {
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

    /// @notice Returns an account's current voting weight.
    function getVotes(address account) external view returns (uint256) {
        return votes[account];
    }

    /// @notice Returns an account's voting weight at a past block number.
    function getPastVotes(address account, uint256 timepoint) external view returns (uint256) {
        if (timepoint >= block.number) revert VoteMirror__FutureLookup();
        return voteCheckpoints[account].upperLookupRecent(uint32(timepoint));
    }

    /// @notice Returns the total voting supply at a past block number.
    function getPastTotalSupply(uint256 timepoint) external view returns (uint256) {
        if (timepoint >= block.number) revert VoteMirror__FutureLookup();
        return supplyCheckpoints.upperLookupRecent(uint32(timepoint));
    }

    /// @dev Delegation is managed exclusively through the staking vault.
    function delegates(address account) external pure returns (address) {
        return account;
    }

    /// @dev Delegation is managed exclusively through the staking vault.
    function delegate(address) external pure {
        revert VoteMirror__VaultDelegationOnly();
    }

    /// @dev Delegation is managed exclusively through the staking vault.
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
