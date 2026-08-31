// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {GovernorUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/GovernorUpgradeable.sol";
import {IGovernorUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/IGovernorUpgradeable.sol";
import {TimelockControllerUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/TimelockControllerUpgradeable.sol";
import {GovernorCountingSimpleUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorCountingSimpleUpgradeable.sol";
import {GovernorSettingsUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorSettingsUpgradeable.sol";
import {GovernorTimelockControlUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorTimelockControlUpgradeable.sol";
import {GovernorVotesUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorVotesUpgradeable.sol";
import {IVotesUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/utils/IVotesUpgradeable.sol";

import {Treasury} from "./Treasury.sol";

/**
 * @title RiskGovernor
 * @author ac
 * @notice DAO governor that batches treasury distributions. Each proposal is
 *         classified critical or low-risk, which drives its delay and quorum.
 */
contract RiskGovernor is
    GovernorUpgradeable,
    GovernorSettingsUpgradeable,
    GovernorCountingSimpleUpgradeable,
    GovernorVotesUpgradeable,
    GovernorTimelockControlUpgradeable
{
    error RiskGovernor__InvalidBatch();
    error RiskGovernor__RiskDelay();

    uint64 public constant LOW_RISK_DELAY = 0;
    uint64 public constant CRITICAL_DELAY = 120;

    /// @notice Quorum (in governance tokens) for low-risk and critical proposals.
    uint256 private constant QUORUM = 100 ether;
    uint256 private constant CRITICAL_QUORUM = 500 ether;

    /// @notice Maximum number of actions a single batch proposal may contain.
    uint256 private constant MAX_BATCH_ACTIONS = 8;

    Treasury public treasury;
    address public treasuryToken;
    uint256 public perActionCritical;

    mapping(uint256 => bool) public criticalProposal;
    mapping(uint256 => uint64) public readyAt;
    mapping(uint256 => address[]) private batchTargets;
    mapping(uint256 => uint256[]) private batchValues;
    mapping(uint256 => bytes[]) private batchCalldatas;
    mapping(uint256 => bytes32) private batchDescriptionHashes;
    mapping(address => uint256) public latestProposalId;

    /// @notice Initialises the governor, its timelock and its risk parameters.
    /// @param m         VoteMirror address (voting token).
    /// @param timelock  TimelockController address.
    /// @param t         Treasury address.
    /// @param asset     Treasury asset distributed by proposals.
    /// @param threshold Per-action value that flips a proposal to critical.
    function initialize(
        address m,
        address timelock,
        address t,
        address asset,
        uint256 threshold
    ) public initializer {
        __Governor_init("DAO Risk Governor");
        __GovernorSettings_init(0, 2, 0);
        __GovernorVotes_init(IVotesUpgradeable(m));
        __GovernorTimelockControl_init(TimelockControllerUpgradeable(payable(timelock)));

        treasury = Treasury(t);
        treasuryToken = asset;
        perActionCritical = threshold;
    }

    /// @notice Proposes a batch of treasury distributions in a single proposal.
    /// @param to    Recipients of each distribution.
    /// @param value Amount of `treasuryToken` sent to each recipient.
    function proposeBatch(
        address[] calldata to,
        uint256[] calldata value
    ) external returns (uint256 id) {
        if (to.length == 0 || to.length != value.length || to.length > MAX_BATCH_ACTIONS) {
            revert RiskGovernor__InvalidBatch();
        }

        bool critical;
        address[] memory targets = new address[](to.length);
        uint256[] memory ethValues = new uint256[](to.length);
        bytes[] memory calldatas = new bytes[](to.length);

        for (uint256 i; i < value.length; ++i) {
            if (value[i] > perActionCritical) {
                critical = true;
            }

            targets[i] = address(treasury);
            calldatas[i] = abi.encodeCall(
                Treasury.distribute,
                (treasuryToken, to[i], value[i])
            );
        }

        string memory description = string.concat(
            "DAO treasury batch ",
            Strings.toString(block.number),
            " ",
            Strings.toHexString(msg.sender)
        );

        id = propose(targets, ethValues, calldatas, description);
        latestProposalId[msg.sender] = id;
        criticalProposal[id] = critical;
        readyAt[id] = uint64(block.timestamp) + (critical ? CRITICAL_DELAY : LOW_RISK_DELAY);
        batchDescriptionHashes[id] = keccak256(bytes(description));

        for (uint256 i; i < targets.length; ++i) {
            batchTargets[id].push(targets[i]);
            batchValues[id].push(0);
            batchCalldatas[id].push(calldatas[i]);
        }
    }

    /// @notice Casts a for-vote on a proposal.
    function castVote(uint256 id) public returns (uint256) {
        return castVote(id, 1);
    }

    /// @notice Queues a batched proposal in the timelock.
    function queueBatch(uint256 id) external returns (uint256) {
        return queue(
            batchTargets[id],
            batchValues[id],
            batchCalldatas[id],
            batchDescriptionHashes[id]
        );
    }

    /// @notice Executes a queued batch after its risk delay has elapsed.
    function executeBatch(uint256 id) external payable returns (uint256) {
        if (block.timestamp < readyAt[id]) revert RiskGovernor__RiskDelay();
        return execute(
            batchTargets[id],
            batchValues[id],
            batchCalldatas[id],
            batchDescriptionHashes[id]
        );
    }

    function quorum(uint256) public pure override returns (uint256) {
        return QUORUM;
    }

    function _quorumReached(
        uint256 id
    ) internal view override(GovernorUpgradeable, GovernorCountingSimpleUpgradeable) returns (bool) {
        (, uint256 forVotes, uint256 abstainVotes) = proposalVotes(id);
        return forVotes + abstainVotes >= (criticalProposal[id] ? CRITICAL_QUORUM : QUORUM);
    }

    // The following functions are overrides required by Solidity.

    function votingDelay()
        public
        view
        override(IGovernorUpgradeable, GovernorSettingsUpgradeable)
        returns (uint256)
    {
        return super.votingDelay();
    }

    function votingPeriod()
        public
        view
        override(IGovernorUpgradeable, GovernorSettingsUpgradeable)
        returns (uint256)
    {
        return super.votingPeriod();
    }

    function proposalThreshold()
        public
        view
        override(GovernorUpgradeable, GovernorSettingsUpgradeable)
        returns (uint256)
    {
        return super.proposalThreshold();
    }

    function state(
        uint256 id
    ) public view override(GovernorUpgradeable, GovernorTimelockControlUpgradeable) returns (ProposalState) {
        return super.state(id);
    }

    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) public override(GovernorUpgradeable, IGovernorUpgradeable) returns (uint256) {
        return super.propose(targets, values, calldatas, description);
    }

    function _execute(
        uint256 id,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(GovernorUpgradeable, GovernorTimelockControlUpgradeable) {
        super._execute(id, targets, values, calldatas, descriptionHash);
    }

    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    )
        internal
        override(GovernorUpgradeable, GovernorTimelockControlUpgradeable)
        returns (uint256)
    {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    function _executor()
        internal
        view
        override(GovernorUpgradeable, GovernorTimelockControlUpgradeable)
        returns (address)
    {
        return super._executor();
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(GovernorUpgradeable, GovernorTimelockControlUpgradeable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
