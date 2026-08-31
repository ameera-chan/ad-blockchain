// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import {IERC20} from "../interfaces/IERC20.sol";
import {ConstantProductAMM} from "../supporting/AMM.sol";

/**
 * @title Treasury
 * @author ac
 * @notice DAO-controlled treasury that disburses assets via governance and can
 *         rebalance between two pooled tokens through the protocol AMM.
 */
contract Treasury is Initializable {
    error Treasury__NotOwner();
    error Treasury__NotGovernor();
    error Treasury__NotOwnerOrGovernorSet();

    address public owner;
    address public governor;
    address public amm;
    address public rebalanceToken;
    address public settlementToken;

    /// @notice Initialises ownership to the deployer (called once by the proxy).
    function initialize() public initializer {
        owner = msg.sender;
    }

    /// @notice Sets the governor (once) that is authorised to call `distribute`.
    function setGovernor(address g) external {
        if (msg.sender != owner || governor != address(0)) revert Treasury__NotOwnerOrGovernorSet();
        governor = g;
    }

    /// @notice Points the treasury at the AMM and the token pair used for rebalancing.
    /// @param a        AMM contract address.
    /// @param tokenIn  Token the treasury sells on rebalance.
    /// @param tokenOut Token the treasury receives on rebalance.
    function configureRebalance(address a, address tokenIn, address tokenOut) external {
        if (msg.sender != owner) revert Treasury__NotOwner();

        amm = a;
        rebalanceToken = tokenIn;
        settlementToken = tokenOut;
    }

    /// @notice Transfers `amount` of `token` to `recipient`. Governor only.
    function distribute(address token, address recipient, uint256 amount) external {
        if (msg.sender != governor) revert Treasury__NotGovernor();
        IERC20(token).transfer(recipient, amount);
    }

    /// @notice Sells `amount` of the rebalance token into the AMM and keeps the output.
    /// @param amount Quantity of the rebalance token to swap.
    /// @return out Amount of the settlement token received.
    function rebalance(uint256 amount) external returns (uint256 out) {
        uint256 quoted = ConstantProductAMM(amm).quote(rebalanceToken, amount);
        uint256 minOut = quoted * 95 / 100;

        IERC20(rebalanceToken).approve(amm, amount);
        out = ConstantProductAMM(amm).swap(rebalanceToken, amount, minOut, address(this));
    }
}
