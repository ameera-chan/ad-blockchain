// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title Token
 * @author ac
 * @notice Owner-mintable, non-standard ERC-20 used for the challenge's
 *         governance, collateral, debt, LP, reward and treasury assets.
 * @dev No transfer fees, no burn, no permit — just the minimal ledger plus an
 *      owner-restricted mint for the bootstrapping phase.
 */
contract Token {
    error Token__NotOwner();
    error Token__InsufficientAllowance();
    error Token__InsufficientBalance();

    string public name;
    string public symbol;
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    address public immutable owner;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    /// @notice Deploys the token and records the creator as the sole minter.
    /// @param n Human-readable token name (e.g. "DAO Governance").
    /// @param s Ticker symbol (e.g. "GOV").
    constructor(string memory n, string memory s) {
        name = n;
        symbol = s;
        owner = msg.sender;
    }

    /// @notice Mints `amount` tokens to `to`. Only the owner may call this.
    /// @param to   Recipient of the newly minted supply.
    /// @param amount Quantity of tokens to create.
    function mint(address to, uint256 amount) external {
        if (msg.sender != owner) revert Token__NotOwner();
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    /// @notice Approves `spender` to transfer up to `amount` of the caller's balance.
    /// @param spender Account granted the allowance.
    /// @param amount  Maximum amount the spender may move.
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    /// @notice Transfers `amount` tokens from the caller to `to`.
    /// @param to     Recipient.
    /// @param amount Quantity to send.
    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    /// @notice Transfers `amount` from `from` to `to`, consuming the caller's allowance.
    /// @param from   Source account.
    /// @param to     Recipient.
    /// @param amount Quantity to send.
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a < amount) revert Token__InsufficientAllowance();

        if (a != type(uint256).max) {
            allowance[from][msg.sender] = a - amount;
        }

        _transfer(from, to, amount);
        return true;
    }

    /// @dev Shared balance-mutation helper; emits no events (non-standard by design).
    function _transfer(address from, address to, uint256 amount) internal {
        if (balanceOf[from] < amount) revert Token__InsufficientBalance();
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}
