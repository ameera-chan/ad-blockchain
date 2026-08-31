// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title DelegateProbe
 * @author ac
 * @notice Test delegatee whose `onVoteSync` observer can be told to fail on
 *         negative deltas, emulating an offline observer.
 */
contract DelegateProbe {
    error DelegateProbe__NotOwner();
    error DelegateProbe__ObserverOffline();

    address public immutable owner;
    bool public failNegative;

    /// @notice Deploys the probe and records its controller.
    /// @param o Controller address.
    constructor(address o) {
        owner = o;
    }

    /// @notice Toggles failure on negative vote deltas. Owner only.
    function setFailNegative(bool value) external {
        if (msg.sender != owner) revert DelegateProbe__NotOwner();
        failNegative = value;
    }

    /// @notice Observer hook invoked by the VoteMirror during vote sync.
    function onVoteSync(int256 delta) external view {
        if (delta < 0 && failNegative) {
            revert DelegateProbe__ObserverOffline();
        }
    }
}
