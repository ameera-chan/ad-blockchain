// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import {IERC20} from "../interfaces/IERC20.sol";
import {OracleHub} from "../supporting/OracleHub.sol";

/**
 * @title LendingVault
 * @author ac
 * @notice Over-collateralised lending vault with an owner-seeded set of positions.
 *         Borrowers' positions can be liquidated once they breach the health ratio.
 */
contract LendingVault is Initializable {
    error LendingVault__NotOwner();
    error LendingVault__PositionClosed();
    error LendingVault__PositionHealthy();
    error LendingVault__EpochMismatch();

    /// @notice Health-check ratio used in `liquidate`: collateralValue * 100 < debtValue * 110.
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

    /// @notice Initialises the vault with its token pair and price oracle.
    /// @param c Collateral token address.
    /// @param d Debt token address.
    /// @param o OracleHub address.
    function initialize(address c, address d, address o) public initializer {
        owner = msg.sender;
        collateralToken = IERC20(c);
        debtToken = IERC20(d);
        oracle = OracleHub(o);
    }

    /// @notice Seeds a position for `user`. Owner only (bootstrap/testing helper).
    function seed(address user, uint128 collateral, uint128 debt) external {
        if (msg.sender != owner) revert LendingVault__NotOwner();
        positions[user] = Position(collateral, debt, true);
    }

    /// @notice Liquidates `user`'s position, paying their debt and seizing the collateral.
    /// @param user            Position owner being liquidated.
    /// @param collateralEpoch Epoch used to price the collateral.
    /// @param debtEpoch       Epoch used to price the debt.
    function liquidate(address user, uint256 collateralEpoch, uint256 debtEpoch) external {
        Position storage p = positions[user];
        if (!p.open) revert LendingVault__PositionClosed();

        uint256 collateralValue =
            uint256(p.collateral) *
            oracle.getPrice(address(collateralToken), collateralEpoch) /
            1 ether;

        uint256 debtValue =
            uint256(p.debt) *
            oracle.getPrice(address(debtToken), debtEpoch) /
            1 ether;

        if (collateralValue * HEALTH_NUMERATOR >= debtValue * HEALTH_DENOMINATOR) {
            revert LendingVault__PositionHealthy();
        }

        p.open = false;
        debtToken.transferFrom(msg.sender, address(this), p.debt);
        collateralToken.transfer(msg.sender, p.collateral);
    }
}
