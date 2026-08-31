// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title OracleHub
 * @author ac
 * @notice Owner-fed price store. The owner records per-(asset, epoch) price
 *         reports; consumers query a report by epoch.
 */
contract OracleHub {
    error OracleHub__NotOwner();
    error OracleHub__NoReport();
    error OracleHub__StaleReport();

    /// @notice Maximum age of a report before it is considered stale.
    uint256 private constant STALENESS = 1 hours;

    struct Report {
        uint128 price;
        uint64 timestamp;
        bool exists;
    }

    address public immutable owner;
    mapping(address => mapping(uint256 => Report)) public reports;

    /// @notice Records the deployer as the sole price reporter.
    constructor() {
        owner = msg.sender;
    }

    /// @notice Stores a price report for `asset` at `epoch`.
    /// @param asset     Token the report prices.
    /// @param epoch     Report identifier chosen by the owner.
    /// @param price     Reported price (18-decimal fixed point).
    /// @param timestamp Report timestamp.
    function setReport(address asset, uint256 epoch, uint128 price, uint64 timestamp) external {
        if (msg.sender != owner) revert OracleHub__NotOwner();
        reports[asset][epoch] = Report(price, timestamp, true);
    }

    /// @notice Returns the recorded price for `asset` at `epoch`, reverting if missing or stale.
    function getPrice(address asset, uint256 epoch) external view returns (uint256) {
        Report memory r = reports[asset][epoch];

        if (!r.exists) revert OracleHub__NoReport();
        if (block.timestamp < r.timestamp || block.timestamp - r.timestamp > STALENESS) {
            revert OracleHub__StaleReport();
        }

        return r.price;
    }
}
