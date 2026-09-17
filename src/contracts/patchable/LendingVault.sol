// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import {IERC20} from "../interfaces/IERC20.sol";
import {OracleHub} from "../supporting/OracleHub.sol";

contract LendingVault is Initializable {
    error LendingVault__NotOwner();
    error LendingVault__PositionClosed();
    error LendingVault__PositionHealthy();

    uint256 private constant HEALTH_NUMERATOR = 100;
    uint256 private constant HEALTH_DENOMINATOR = 110;

    struct Position {
        uint128 collateral;
        uint128 debt;
        bool open;
    }

    address public owner;
    IERC20 public collateralToken;
    IERC20 public debtToken;
    OracleHub public oracle;

    mapping(address => Position) public positions;

    function initialize(address c, address d, address o) public initializer {
        owner = msg.sender;
        collateralToken = IERC20(c);
        debtToken = IERC20(d);
        oracle = OracleHub(o);
    }

    function seed(address user, uint128 collateral, uint128 debt) external {
        if (msg.sender != owner) revert LendingVault__NotOwner();
        positions[user] = Position(collateral, debt, true);
    }

    function liquidate(address user, uint256 collateralReportId, uint256 debtReportId) external {
        Position storage p = positions[user];
        if (!p.open) revert LendingVault__PositionClosed();

        uint256 collateralValue =
            uint256(p.collateral) *
            oracle.getPrice(address(collateralToken), collateralReportId) /
            1 ether;

        uint256 debtValue =
            uint256(p.debt) *
            oracle.getPrice(address(debtToken), debtReportId) /
            1 ether;

        if (collateralValue * HEALTH_NUMERATOR >= debtValue * HEALTH_DENOMINATOR) {
            revert LendingVault__PositionHealthy();
        }

        p.open = false;
        debtToken.transferFrom(msg.sender, address(this), p.debt);
        collateralToken.transfer(msg.sender, p.collateral);
    }
}
