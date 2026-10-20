// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @dev Minimal ERC-20 mock with:
 *   - mint, 6-decimal default, full transfer/approve surface
 *   - blocklist: block(address) / unblock(address) — blocked transfers REVERT by default
 *   - returnFalseMode: setReturnFalseMode(true) → blocked transfers return false instead of reverting
 *
 * Used by MilestoneEscrow tests to exercise _tryTransfer revert-path and returns-false-path.
 */
contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    mapping(address => bool) public blocked;
    bool public returnFalseMode;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    // ── admin ────────────────────────────────────────────────────────────────

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    /// @notice Block `account` — transfers to/from it will fail per current mode.
    function block(address account) external {
        blocked[account] = true;
    }

    /// @notice Unblock `account`.
    function unblock(address account) external {
        blocked[account] = false;
    }

    /**
     * @notice Switch between revert mode (default, false) and returns-false mode (true).
     *         In returns-false mode, blocked-address transfers return false instead of reverting.
     */
    function setReturnFalseMode(bool on) external {
        returnFalseMode = on;
    }

    // ── ERC-20 ───────────────────────────────────────────────────────────────

    function transfer(address to, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "MockERC20: insufficient allowance");
            allowance[from][msg.sender] = allowed - amount;
        }
        return _transfer(from, to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    // ── internal ─────────────────────────────────────────────────────────────

    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        // Check blocklist
        if (blocked[from] || blocked[to]) {
            if (returnFalseMode) return false;
            revert("MockERC20: blocked");
        }
        require(balanceOf[from] >= amount, "MockERC20: insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
