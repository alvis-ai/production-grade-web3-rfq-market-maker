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
    event OwnerUpdated(address indexed oldOwner, address indexed newOwner);
    event TrustedSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event TokenWhitelistUpdated(address indexed token, bool whitelisted);
    event PausedUpdated(bool paused);

    function submitQuote(Quote calldata quote, bytes calldata signature)
        external
        returns (uint256 amountOut);

    function setTrustedSigner(address newTrustedSigner) external;
    function setTokenWhitelist(address token, bool whitelisted) external;
    function setPaused(bool newPaused) external;
    function transferOwnership(address newOwner) external;
    function domainSeparator() external view returns (bytes32);
    function hashTypedData(bytes32 structHash) external view returns (bytes32);
}
