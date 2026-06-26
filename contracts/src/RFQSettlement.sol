// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IRFQSettlement } from "./interfaces/IRFQSettlement.sol";

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice RFQ settlement contract for validating EIP-712 signed quotes and settling token flows.
/// @dev This dependency-free implementation mirrors the intended OpenZeppelin production surface:
/// EIP712, SafeERC20, ReentrancyGuard, Pausable, and owner-gated administrative controls.
contract RFQSettlement is IRFQSettlement {
    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "Quote(address user,address tokenIn,address tokenOut,uint256 amountIn,uint256 amountOut,uint256 minAmountOut,uint256 nonce,uint256 deadline,uint256 chainId)"
    );
    bytes32 public constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 public constant NAME_HASH = keccak256("ProductionGradeRFQ");
    bytes32 public constant VERSION_HASH = keccak256("1");

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private constant _SECP256K1N_HALF =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    address public owner;
    address public trustedSigner;
    bool public paused;
    mapping(address token => bool whitelisted) public tokenWhitelist;
    mapping(address user => mapping(uint256 nonce => bool used)) public usedNonces;

    uint256 private _reentrancyStatus = _NOT_ENTERED;

    error NotOwner();
    error Paused();
    error ReentrantCall();
    error InvalidAddress();
    error InvalidSigner();
    error InvalidSignatureLength();
    error InvalidSignatureS();
    error InvalidSignatureV();
    error InvalidChainId();
    error QuoteExpired();
    error NonceAlreadyUsed();
    error TokenNotWhitelisted();
    error InvalidQuoteUser();
    error InvalidTokenPair();
    error InvalidAmount();
    error AmountOutBelowMinimum();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier nonReentrant() {
        if (_reentrancyStatus == _ENTERED) revert ReentrantCall();
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
    }

    constructor(address initialTrustedSigner) {
        if (initialTrustedSigner == address(0)) revert InvalidAddress();
        owner = msg.sender;
        trustedSigner = initialTrustedSigner;

        emit OwnerUpdated(address(0), msg.sender);
        emit TrustedSignerUpdated(address(0), initialTrustedSigner);
    }

    function submitQuote(Quote calldata quote, bytes calldata signature)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 amountOut)
    {
        _validateQuoteShape(quote);

        bytes32 quoteHash = hashQuote(quote);
        _verifySignature(hashTypedData(quoteHash), signature);

        usedNonces[quote.user][quote.nonce] = true;
        _safeTransferFrom(quote.tokenIn, quote.user, address(this), quote.amountIn);
        _safeTransfer(quote.tokenOut, quote.user, quote.amountOut);

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

    function setTrustedSigner(address newTrustedSigner) external onlyOwner {
        if (newTrustedSigner == address(0)) revert InvalidAddress();
        emit TrustedSignerUpdated(trustedSigner, newTrustedSigner);
        trustedSigner = newTrustedSigner;
    }

    function setTokenWhitelist(address token, bool whitelisted) external onlyOwner {
        if (token == address(0)) revert InvalidAddress();
        tokenWhitelist[token] = whitelisted;
        emit TokenWhitelistUpdated(token, whitelisted);
    }

    function setPaused(bool newPaused) external onlyOwner {
        paused = newPaused;
        emit PausedUpdated(newPaused);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnerUpdated(owner, newOwner);
        owner = newOwner;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this))
        );
    }

    function hashTypedData(bytes32 structHash) public view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
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
        if (quote.tokenIn == quote.tokenOut) revert InvalidTokenPair();
        if (quote.amountIn == 0 || quote.amountOut == 0 || quote.minAmountOut == 0) {
            revert InvalidAmount();
        }
        if (!tokenWhitelist[quote.tokenIn] || !tokenWhitelist[quote.tokenOut]) {
            revert TokenNotWhitelisted();
        }
        if (quote.amountOut < quote.minAmountOut) revert AmountOutBelowMinimum();
    }

    function _verifySignature(bytes32 digest, bytes calldata signature) internal view {
        if (signature.length != 65) revert InvalidSignatureLength();

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := byte(0, calldataload(add(signature.offset, 0x40)))
        }

        if (uint256(s) > _SECP256K1N_HALF) revert InvalidSignatureS();
        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert InvalidSignatureV();

        address recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0) || recovered != trustedSigner) revert InvalidSigner();
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory data) =
            token.call(abi.encodeCall(IERC20Minimal.transfer, (to, amount)));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) =
            token.call(abi.encodeCall(IERC20Minimal.transferFrom, (from, to, amount)));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
