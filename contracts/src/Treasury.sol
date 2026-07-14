// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Treasury custody boundary around RFQ settlement.
/// @dev Uses OpenZeppelin SafeERC20 and ReentrancyGuard with owner-gated custody controls.
contract Treasury is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public settlement;
    address public owner;

    error NotOwner();
    error NotSettlement();
    error InvalidAddress();
    error InvalidAmount();
    error TransferFailed();

    event SettlementUpdated(address indexed oldSettlement, address indexed newSettlement);
    event OwnerUpdated(address indexed oldOwner, address indexed newOwner);
    event FundsReleased(
        address indexed settlement, address indexed token, address indexed to, uint256 amount
    );
    event EmergencyWithdrawal(
        address indexed owner, address indexed token, address indexed to, uint256 amount
    );

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert InvalidAddress();
        owner = initialOwner;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlySettlement() {
        if (msg.sender != settlement) revert NotSettlement();
        _;
    }

    function setSettlement(address newSettlement) external onlyOwner {
        if (newSettlement == address(0)) revert InvalidAddress();
        emit SettlementUpdated(settlement, newSettlement);
        settlement = newSettlement;
    }

    function release(address token, address to, uint256 amount)
        external
        onlySettlement
        nonReentrant
    {
        _validateTransfer(token, to, amount);
        _safeTransfer(token, to, amount);
        emit FundsReleased(msg.sender, token, to, amount);
    }

    function emergencyWithdraw(address token, address to, uint256 amount)
        external
        onlyOwner
        nonReentrant
    {
        _validateTransfer(token, to, amount);
        _safeTransfer(token, to, amount);
        emit EmergencyWithdrawal(msg.sender, token, to, amount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnerUpdated(owner, newOwner);
        owner = newOwner;
    }

    function _validateTransfer(address token, address to, uint256 amount) internal pure {
        if (token == address(0) || to == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        if (!IERC20(token).trySafeTransfer(to, amount)) revert TransferFailed();
    }
}
