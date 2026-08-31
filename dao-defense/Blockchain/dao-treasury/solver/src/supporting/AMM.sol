// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "../interfaces/IERC20.sol";

/**
 * @title ConstantProductAMM
 * @author ac
 * @notice Minimal x*y=k automated market maker between two tokens.
 * @dev The price used by `quote` is the current reserve ratio (the spot price).
 *      See `Treasury.rebalance` for how the protocol consumes this quote.
 */
contract ConstantProductAMM {
    error ConstantProductAMM__InvalidToken();
    error ConstantProductAMM__InsufficientOutput();

    /// @notice 0.3% fee, expressed as numerator over `FEE_DENOMINATOR`.
    uint256 private constant FEE_NUMERATOR = 997;
    uint256 private constant FEE_DENOMINATOR = 1000;

    IERC20 public immutable token0;
    IERC20 public immutable token1;

    uint256 public reserve0;
    uint256 public reserve1;

    /// @notice Creates the pair and records the two pooled tokens.
    /// @param a Address of the first token.
    /// @param b Address of the second token.
    constructor(address a, address b) {
        token0 = IERC20(a);
        token1 = IERC20(b);
    }

    /// @notice Deposits `a` of token0 and `b` of token1, growing both reserves.
    function addLiquidity(uint256 a, uint256 b) external {
        token0.transferFrom(msg.sender, address(this), a);
        token1.transferFrom(msg.sender, address(this), b);

        reserve0 += a;
        reserve1 += b;
    }

    /// @notice Returns the amount-out for `amountIn` of `tokenIn` at the current reserves.
    /// @param tokenIn  Token being sold.
    /// @param amountIn Quantity being sold.
    /// @return out Amount of the counterpart token the caller would receive.
    function quote(address tokenIn, uint256 amountIn) public view returns (uint256) {
        if (tokenIn != address(token0) && tokenIn != address(token1)) {
            revert ConstantProductAMM__InvalidToken();
        }

        (uint256 rin, uint256 rout) =
            tokenIn == address(token0) ? (reserve0, reserve1) : (reserve1, reserve0);

        uint256 feeAmount = amountIn * FEE_NUMERATOR;
        return feeAmount * rout / (rin * FEE_DENOMINATOR + feeAmount);
    }

    /// @notice Swaps `amountIn` of `tokenIn` for the quoted counterpart, enforcing `minOut`.
    /// @param tokenIn   Token being sold.
    /// @param amountIn  Quantity being sold.
    /// @param minOut    Slippage floor for the amount received.
    /// @param recipient Account credited with the output tokens.
    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minOut,
        address recipient
    ) external returns (uint256 out) {
        out = quote(tokenIn, amountIn);
        if (out < minOut || out == 0) revert ConstantProductAMM__InsufficientOutput();

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
