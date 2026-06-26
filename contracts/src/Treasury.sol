// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Treasury skeleton for custody boundaries around RFQ settlement.
/// @dev The production implementation will use AccessControl and SafeERC20 after dependencies are installed.
contract Treasury {
    address public settlement;
    address public owner;

    error NotOwner();
    error NotSettlement();
    error InvalidAddress();

    event SettlementUpdated(address indexed oldSettlement, address indexed newSettlement);
    event OwnerUpdated(address indexed oldOwner, address indexed newOwner);

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

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnerUpdated(owner, newOwner);
        owner = newOwner;
    }
}
