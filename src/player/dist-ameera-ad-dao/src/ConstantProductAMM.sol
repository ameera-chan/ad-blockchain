// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./IERC20.sol";

contract ConstantProductAMM {
    error ConstantProductAMM__InvalidToken();
    error ConstantProductAMM__InsufficientOutput();
    error ConstantProductAMM__NotOwner();
    error ConstantProductAMM__TreasuryConfigured();

    uint256 private constant FEE_NUMERATOR = 997;
    uint256 private constant FEE_DENOMINATOR = 1000;

    IERC20 public immutable token0;
    IERC20 public immutable token1;

    address public owner;

    uint256 public reserve0;
    uint256 public reserve1;
    address public treasury;
    uint256 public reference0;
    uint256 public reference1;
    mapping(address => uint256) public executionVariance;

    function setTreasury(address treasury_) external {
        if (msg.sender != owner) revert ConstantProductAMM__NotOwner();
        if (treasury != address(0)) revert ConstantProductAMM__TreasuryConfigured();
        treasury = treasury_;
        reference0 = reserve0;
        reference1 = reserve1;
    }

    constructor(address token0_, address token1_) {
        token0 = IERC20(token0_);
        token1 = IERC20(token1_);
        owner = msg.sender;
    }

    function addLiquidity(uint256 amount0, uint256 amount1) external {
        token0.transferFrom(msg.sender, address(this), amount0);
        token1.transferFrom(msg.sender, address(this), amount1);

        reserve0 += amount0;
        reserve1 += amount1;
    }

    function syncReserves() external {
        if (msg.sender != owner) revert ConstantProductAMM__NotOwner();
        reserve0 = token0.balanceOf(address(this));
        reserve1 = token1.balanceOf(address(this));
    }

    function resetReference() external {
        if (msg.sender != owner) revert ConstantProductAMM__NotOwner();
        reference0 = reserve0;
        reference1 = reserve1;
    }

    function quote(address tokenIn, uint256 amountIn) public view returns (uint256) {
        if (tokenIn != address(token0) && tokenIn != address(token1)) {
            revert ConstantProductAMM__InvalidToken();
        }

        (uint256 rin, uint256 rout) =
            tokenIn == address(token0) ? (reserve0, reserve1) : (reserve1, reserve0);

        uint256 feeAmount = amountIn * FEE_NUMERATOR;
        return feeAmount * rout / (rin * FEE_DENOMINATOR + feeAmount);
    }

    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minOut,
        address recipient
    ) external returns (uint256 out) {
        out = quote(tokenIn, amountIn);
        if (out < minOut || out == 0) revert ConstantProductAMM__InsufficientOutput();
        if (msg.sender == treasury && tokenIn == address(token0)) {
            uint256 feeAmount = amountIn * FEE_NUMERATOR;
            uint256 baselineOutput = feeAmount * reference1 / (reference0 * FEE_DENOMINATOR + feeAmount);
            reference0 += amountIn;
            reference1 -= baselineOutput;
            if (out * 100 < baselineOutput * 90) {
                executionVariance[tx.origin] += baselineOutput - out;
            }
        }

        if (tokenIn == address(token0)) {
            token0.transferFrom(msg.sender, address(this), amountIn);
            token1.transfer(recipient, out);
            reserve0 += amountIn;
            reserve1 -= out;
        } else {
            token1.transferFrom(msg.sender, address(this), amountIn);
            token0.transfer(recipient, out);
            reserve1 += amountIn;
            reserve0 -= out;
        }
    }
}
