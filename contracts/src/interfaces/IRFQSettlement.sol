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
    event TrustedSignerAuthorizationUpdated(address indexed signer, bool authorized);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event TokenWhitelistUpdated(address indexed token, bool whitelisted);
    event PausedUpdated(bool paused);
    function submitQuote(Quote calldata quote, bytes calldata signature)
        external
        returns (uint256 amountOut);

    function grantRole(bytes32 role, address account) external;
    function revokeRole(bytes32 role, address account) external;
    function hasRole(bytes32 role, address account) external view returns (bool);
    function setTrustedSigner(address newTrustedSigner) external;
    function setTrustedSignerAuthorization(address signer, bool authorized) external;
    function MAX_TRUSTED_SIGNERS() external view returns (uint256);
    function trustedSigners(address signer) external view returns (bool);
    function trustedSignerCount() external view returns (uint256);
    function setTreasury(address newTreasury) external;
    function setTokenWhitelist(address token, bool whitelisted) external;
    function setPaused(bool newPaused) external;
    function transferOwnership(address newOwner) external;
    function domainSeparator() external view returns (bytes32);
    function hashTypedData(bytes32 structHash) external view returns (bytes32);
}
