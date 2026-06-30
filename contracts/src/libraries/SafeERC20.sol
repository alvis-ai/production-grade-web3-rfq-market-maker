// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Minimal SafeERC20-compatible transfer helpers.
/// @dev Accepts ERC20 tokens that return true or no data, and rejects false returns.
library SafeERC20 {
    error TransferFailed();

    function safeTransfer(address token, address to, uint256 amount) internal {
        _callOptionalReturn(token, abi.encodeCall(IERC20Minimal.transfer, (to, amount)));
    }

    function safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        _callOptionalReturn(token, abi.encodeCall(IERC20Minimal.transferFrom, (from, to, amount)));
    }

    function _callOptionalReturn(address token, bytes memory callData) private {
        if (token.code.length == 0) revert TransferFailed();
        (bool success, bytes memory data) = token.call(callData);
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TransferFailed();
        }
    }
}
