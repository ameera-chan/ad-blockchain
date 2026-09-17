// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import {IERC20} from "./IERC20.sol";
import {ConstantProductAMM} from "./AMM.sol";

contract Treasury is Initializable {
    error Treasury__NotOwner();
    error Treasury__NotGovernor();
    error Treasury__NotOwnerOrGovernorSet();
    error Treasury__InvalidTradeSize();

    address public owner;
    address public governor;
    address public amm;
    address public rebalanceToken;
    address public settlementToken;

    uint256 public lastRebalanceAmount;
    uint256 public lastRebalanceOutput;

    function initialize() public initializer {
        owner = msg.sender;
    }

    function setGovernor(address g) external {
        if (msg.sender != owner || governor != address(0)) revert Treasury__NotOwnerOrGovernorSet();
        governor = g;
    }

    function configureRebalance(address a, address tokenIn, address tokenOut) external {
        if (msg.sender != owner) revert Treasury__NotOwner();

        amm = a;
        rebalanceToken = tokenIn;
        settlementToken = tokenOut;
    }

    function resetRebalanceState() external {
        if (msg.sender != owner) revert Treasury__NotOwner();
        lastRebalanceAmount = 0;
        lastRebalanceOutput = 0;
    }

    function distribute(address token, address recipient, uint256 amount) external {
        if (msg.sender != governor) revert Treasury__NotGovernor();
        IERC20(token).transfer(recipient, amount);
    }

    function rebalance(uint256 amount) external returns (uint256 out) {
        if (amount == 0 || amount > 100 ether) revert Treasury__InvalidTradeSize();
        uint256 quoted = ConstantProductAMM(amm).quote(rebalanceToken, amount);
        uint256 minOut = quoted * 95 / 100;

        IERC20(rebalanceToken).approve(amm, amount);
        out = ConstantProductAMM(amm).swap(rebalanceToken, amount, minOut, address(this));
        lastRebalanceAmount = amount;
        lastRebalanceOutput = out;
    }
}
