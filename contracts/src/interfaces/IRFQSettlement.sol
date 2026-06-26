// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRFQSettlement {
    struct Quote {
        address user;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOut;
        uint256 minAmountOut;
        uint256 nonce;
        uint256 deadline;
        uint256 chainId;
    }

    event QuoteSettled(
        bytes32 indexed quoteHash,
        address indexed user,
        address indexed tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 nonce
    );

    function submitQuote(
        Quote calldata quote,
        bytes calldata signature
    ) external returns (uint256 amountOut);
}
