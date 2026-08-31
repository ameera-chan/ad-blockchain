// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IERC20
 * @notice Minimal ERC-20 surface shared by every DAO treasury component.
 * @dev Deliberately trimmed to the four functions the protocol depends on
 *      (balanceOf / transfer / transferFrom / approve). A full ERC-20 would also
 *      expose allowance getters, totalSupply and Transfer/Approval events; those
 *      are omitted to keep the interface focused on the challenge's token flows.
 */
interface IERC20 {
    function balanceOf(address user) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}
