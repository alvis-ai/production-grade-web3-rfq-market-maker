// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Treasury custody boundary around RFQ settlement.
/// @dev Dependency-free custody boundary mirroring SafeERC20, ReentrancyGuard, and owner-gated controls.
contract Treasury {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    address public settlement;
    address public owner;

    uint256 private _reentrancyStatus = _NOT_ENTERED;

    error NotOwner();
    error NotSettlement();
    error ReentrantCall();
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

    modifier nonReentrant() {
        if (_reentrancyStatus == _ENTERED) revert ReentrantCall();
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
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
        (bool success, bytes memory data) =
            token.call(abi.encodeWithSignature("transfer(address,uint256)", to, amount));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
