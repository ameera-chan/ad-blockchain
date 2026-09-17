

pragma solidity ^0.8.0;

import "./GovernorVotesUpgradeable.sol";
import "../../utils/CheckpointsUpgradeable.sol";
import "../../utils/math/SafeCastUpgradeable.sol";
import {Initializable} from "../../proxy/utils/Initializable.sol";

abstract contract GovernorVotesQuorumFractionUpgradeable is Initializable, GovernorVotesUpgradeable {
    using CheckpointsUpgradeable for CheckpointsUpgradeable.Trace224;

    uint256 private _quorumNumerator;

    CheckpointsUpgradeable.Trace224 private _quorumNumeratorHistory;

    event QuorumNumeratorUpdated(uint256 oldQuorumNumerator, uint256 newQuorumNumerator);

    function __GovernorVotesQuorumFraction_init(uint256 quorumNumeratorValue) internal onlyInitializing {
        __GovernorVotesQuorumFraction_init_unchained(quorumNumeratorValue);
    }

    function __GovernorVotesQuorumFraction_init_unchained(uint256 quorumNumeratorValue) internal onlyInitializing {
        _updateQuorumNumerator(quorumNumeratorValue);
    }

    function quorumNumerator() public view virtual returns (uint256) {
        return _quorumNumeratorHistory._checkpoints.length == 0 ? _quorumNumerator : _quorumNumeratorHistory.latest();
    }

    function quorumNumerator(uint256 timepoint) public view virtual returns (uint256) {

        uint256 length = _quorumNumeratorHistory._checkpoints.length;
        if (length == 0) {
            return _quorumNumerator;
        }

        CheckpointsUpgradeable.Checkpoint224 memory latest = _quorumNumeratorHistory._checkpoints[length - 1];
        if (latest._key <= timepoint) {
            return latest._value;
        }

        return _quorumNumeratorHistory.upperLookupRecent(SafeCastUpgradeable.toUint32(timepoint));
    }

    function quorumDenominator() public view virtual returns (uint256) {
        return 100;
    }

    function quorum(uint256 timepoint) public view virtual override returns (uint256) {
        return (token.getPastTotalSupply(timepoint) * quorumNumerator(timepoint)) / quorumDenominator();
    }

    function updateQuorumNumerator(uint256 newQuorumNumerator) external virtual onlyGovernance {
        _updateQuorumNumerator(newQuorumNumerator);
    }

    function _updateQuorumNumerator(uint256 newQuorumNumerator) internal virtual {
        require(
            newQuorumNumerator <= quorumDenominator(),
            "GovernorVotesQuorumFraction: quorumNumerator over quorumDenominator"
        );

        uint256 oldQuorumNumerator = quorumNumerator();

        if (oldQuorumNumerator != 0 && _quorumNumeratorHistory._checkpoints.length == 0) {
            _quorumNumeratorHistory._checkpoints.push(
                CheckpointsUpgradeable.Checkpoint224({_key: 0, _value: SafeCastUpgradeable.toUint224(oldQuorumNumerator)})
            );
        }

        _quorumNumeratorHistory.push(SafeCastUpgradeable.toUint32(clock()), SafeCastUpgradeable.toUint224(newQuorumNumerator));

        emit QuorumNumeratorUpdated(oldQuorumNumerator, newQuorumNumerator);
    }

    uint256[48] private __gap;
}
