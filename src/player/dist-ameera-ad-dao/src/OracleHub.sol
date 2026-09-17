// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract OracleHub {
    error OracleHub__NotOwner();
    error OracleHub__NoReport();
    error OracleHub__StaleReport();

    uint256 private constant STALENESS = 1 hours;

    struct Report {
        uint128 price;
        uint64 timestamp;
        bool exists;
    }

    address public immutable owner;
    mapping(address => mapping(uint256 => Report)) public reports;

    constructor() {
        owner = msg.sender;
    }

    function setReport(address asset, uint256 epoch, uint128 price, uint64 timestamp) external {
        if (msg.sender != owner) revert OracleHub__NotOwner();
        reports[asset][epoch] = Report(price, timestamp, true);
    }

    function getPrice(address asset, uint256 epoch) external view returns (uint256) {
        Report memory r = reports[asset][epoch];

        if (!r.exists) revert OracleHub__NoReport();
        if (block.timestamp < r.timestamp || block.timestamp - r.timestamp > STALENESS) {
            revert OracleHub__StaleReport();
        }

        return r.price;
    }

    function refresh(address collateral, address debt) external {
        if (msg.sender != owner) revert OracleHub__NotOwner();
        uint64 now_ = uint64(block.timestamp);
        reports[collateral][1] = Report(2 ether, now_, true);
        reports[debt][1] = Report(2 ether, now_, true);
        reports[collateral][2] = Report(1 ether, now_, true);
        reports[debt][2] = Report(1 ether, now_, true);
    }
}
