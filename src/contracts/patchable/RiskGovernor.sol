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
import {VoteMirror} from "./VoteMirror.sol";
import {GovStakingVault} from "../supporting/GovStakingVault.sol";
import {IERC20} from "../interfaces/IERC20.sol";

contract RiskGovernor is
    GovernorUpgradeable,
    GovernorSettingsUpgradeable,
    GovernorCountingSimpleUpgradeable,
    GovernorVotesUpgradeable,
    GovernorTimelockControlUpgradeable
{
    error RiskGovernor__InvalidProposal();
    error RiskGovernor__ExecutionNotReady();

    uint64 public constant STANDARD_DELAY = 0;
    uint64 public constant EXTENDED_DELAY = 120;

    uint256 private constant STANDARD_QUORUM = 100 ether;
    uint256 private constant EXTENDED_QUORUM = 500 ether;

    uint256 private constant MAX_BATCH_ACTIONS = 8;

    Treasury public treasury;
    address public treasuryToken;
    uint256 public reviewThreshold;

    mapping(uint256 => bool) public extendedReview;
    mapping(uint256 => uint64) public executionTime;
    mapping(uint256 => address[]) private batchTargets;
    mapping(uint256 => uint256[]) private batchValues;
    mapping(uint256 => bytes[]) private batchCalldatas;
    mapping(uint256 => bytes32) private batchDescriptionHashes;
    mapping(address => uint256) public latestProposalId;
    mapping(uint256 => bool) private approvedBatch;
    bool private creatingBatch;

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
        reviewThreshold = threshold;
    }

    function proposeBatch(
        address[] calldata to,
        uint256[] calldata value
    ) external returns (uint256 id) {
        if (to.length == 0 || to.length != value.length || to.length > MAX_BATCH_ACTIONS) {
            revert RiskGovernor__InvalidProposal();
        }

        bool requiresExtendedReview;
        address[] memory targets = new address[](to.length);
        uint256[] memory ethValues = new uint256[](to.length);
        bytes[] memory calldatas = new bytes[](to.length);

        for (uint256 i; i < value.length; ++i) {
            if (value[i] > reviewThreshold) {
                requiresExtendedReview = true;
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

        creatingBatch = true;
        id = propose(targets, ethValues, calldatas, description);
        creatingBatch = false;
        approvedBatch[id] = true;
        latestProposalId[msg.sender] = id;
        extendedReview[id] = requiresExtendedReview;
        executionTime[id] = uint64(block.timestamp) +
            (requiresExtendedReview ? EXTENDED_DELAY : STANDARD_DELAY);
        batchDescriptionHashes[id] = keccak256(bytes(description));

        for (uint256 i; i < targets.length; ++i) {
            batchTargets[id].push(targets[i]);
            batchValues[id].push(0);
            batchCalldatas[id].push(calldatas[i]);
        }
    }

    function castVote(uint256 id) public returns (uint256) {
        return castVote(id, 1);
    }

    function queueBatch(uint256 id) external returns (uint256) {
        return queue(
            batchTargets[id],
            batchValues[id],
            batchCalldatas[id],
            batchDescriptionHashes[id]
        );
    }

    function queue(address[] memory targets, uint256[] memory values, bytes[] memory calldatas, bytes32 descriptionHash)
        public override returns (uint256)
    {
        uint256 id = hashProposal(targets, values, calldatas, descriptionHash);
        if (!approvedBatch[id]) revert RiskGovernor__InvalidProposal();
        if (block.timestamp < executionTime[id]) revert RiskGovernor__ExecutionNotReady();
        return super.queue(targets, values, calldatas, descriptionHash);
    }

    function executeBatch(uint256 id) external payable returns (uint256) {
        if (block.timestamp < executionTime[id]) revert RiskGovernor__ExecutionNotReady();
        return execute(
            batchTargets[id],
            batchValues[id],
            batchCalldatas[id],
            batchDescriptionHashes[id]
        );
    }

    function quorum(uint256) public pure override returns (uint256) {
        return STANDARD_QUORUM;
    }

    function _quorumReached(
        uint256 id
    ) internal view override(GovernorUpgradeable, GovernorCountingSimpleUpgradeable) returns (bool) {
        (, uint256 forVotes, uint256 abstainVotes) = proposalVotes(id);
        uint256 required = STANDARD_QUORUM;
        if (extendedReview[id]) {
            address vault_ = VoteMirror(address(token)).vault();
            IERC20 gov = GovStakingVault(vault_).token();
            uint256 backing = gov.balanceOf(vault_);
            required = backing + 1 > EXTENDED_QUORUM ? backing + 1 : EXTENDED_QUORUM;
        }
        return forVotes + abstainVotes >= required;
    }

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
        if (!creatingBatch) revert RiskGovernor__InvalidProposal();
        return super.propose(targets, values, calldatas, description);
    }

    function _execute(
        uint256 id,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(GovernorUpgradeable, GovernorTimelockControlUpgradeable) {
        if (!approvedBatch[id]) revert RiskGovernor__InvalidProposal();
        if (block.timestamp < executionTime[id]) revert RiskGovernor__ExecutionNotReady();
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
