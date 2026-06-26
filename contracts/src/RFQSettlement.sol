// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRFQSettlement} from "./interfaces/IRFQSettlement.sol";

/// @notice Skeleton for the RFQ settlement contract.
/// @dev The production implementation will add OpenZeppelin EIP712, SafeERC20,
/// ReentrancyGuard, Pausable, and AccessControl dependencies after Foundry deps are installed.
contract RFQSettlement is IRFQSettlement {
    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "Quote(address user,address tokenIn,address tokenOut,uint256 amountIn,uint256 amountOut,uint256 minAmountOut,uint256 nonce,uint256 deadline,uint256 chainId)"
    );

    address public trustedSigner;
    mapping(address token => bool whitelisted) public tokenWhitelist;
    mapping(address user => mapping(uint256 nonce => bool used)) public usedNonces;

    error InvalidSigner();
    error InvalidChainId();
    error QuoteExpired();
    error NonceAlreadyUsed();
    error TokenNotWhitelisted();
    error InvalidQuoteUser();
    error AmountOutBelowMinimum();

    constructor(address initialTrustedSigner) {
        trustedSigner = initialTrustedSigner;
    }

    function submitQuote(
        Quote calldata quote,
        bytes calldata signature
    ) external returns (uint256 amountOut) {
        _validateQuoteShape(quote);

        bytes32 quoteHash = hashQuote(quote);
        _verifySignature(quoteHash, signature);

        usedNonces[quote.user][quote.nonce] = true;

        // Asset transfers are intentionally deferred until OpenZeppelin SafeERC20 is wired.
        emit QuoteSettled(
            quoteHash,
            quote.user,
            quote.tokenIn,
            quote.tokenOut,
            quote.amountIn,
            quote.amountOut,
            quote.nonce
        );

        return quote.amountOut;
    }

    function hashQuote(Quote calldata quote) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                QUOTE_TYPEHASH,
                quote.user,
                quote.tokenIn,
                quote.tokenOut,
                quote.amountIn,
                quote.amountOut,
                quote.minAmountOut,
                quote.nonce,
                quote.deadline,
                quote.chainId
            )
        );
    }

    function _validateQuoteShape(Quote calldata quote) internal view {
        if (quote.user != msg.sender) revert InvalidQuoteUser();
        if (quote.chainId != block.chainid) revert InvalidChainId();
        if (quote.deadline < block.timestamp) revert QuoteExpired();
        if (usedNonces[quote.user][quote.nonce]) revert NonceAlreadyUsed();
        if (!tokenWhitelist[quote.tokenIn] || !tokenWhitelist[quote.tokenOut]) {
            revert TokenNotWhitelisted();
        }
        if (quote.amountOut < quote.minAmountOut) revert AmountOutBelowMinimum();
    }

    function _verifySignature(bytes32, bytes calldata) internal view {
        if (trustedSigner == address(0)) revert InvalidSigner();
        // Signature recovery is intentionally deferred to the OpenZeppelin EIP712 implementation.
    }
}
