// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IRFQSettlement } from "./interfaces/IRFQSettlement.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

interface ITreasuryMinimal {
    function release(address token, address to, uint256 amount) external;
}

/// @notice RFQ settlement contract for validating EIP-712 signed quotes and settling token flows.
contract RFQSettlement is IRFQSettlement, EIP712, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "Quote(address user,address tokenIn,address tokenOut,uint256 amountIn,uint256 amountOut,uint256 minAmountOut,uint256 nonce,uint256 deadline,uint256 chainId)"
    );
    bytes32 public constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 public constant NAME_HASH = keccak256("ProductionGradeRFQ");
    bytes32 public constant VERSION_HASH = keccak256("1");
    bytes32 public constant SIGNER_ADMIN_ROLE = keccak256("SIGNER_ADMIN_ROLE");
    bytes32 public constant TOKEN_ADMIN_ROLE = keccak256("TOKEN_ADMIN_ROLE");
    bytes32 public constant TREASURY_ADMIN_ROLE = keccak256("TREASURY_ADMIN_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint256 public constant MAX_TRUSTED_SIGNERS = 5;

    address public owner;
    address public trustedSigner;
    address public treasury;
    mapping(address signer => bool authorized) public trustedSigners;
    mapping(address token => bool whitelisted) public tokenWhitelist;
    mapping(address user => mapping(uint256 nonce => bool used)) public usedNonces;
    mapping(bytes32 role => uint256 count) private _roleMemberCounts;
    uint256 private _trustedSignerCount;

    error NotOwner();
    error InvalidAddress();
    error InvalidSigner();
    error TooManyTrustedSigners();
    error CannotRevokePrimaryTrustedSigner();
    error CannotRevokeLastTrustedSigner();
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
    error InvalidNonce();
    error AmountOutBelowMinimum();
    error TransferFailed();
    error InputTransferAmountMismatch(
        uint256 expectedAmount, uint256 actualUserDebit, uint256 actualTreasuryCredit
    );
    error OutputTransferAmountMismatch(
        uint256 expectedAmount, uint256 actualTreasuryDebit, uint256 actualUserCredit
    );
    error MissingRole(bytes32 role, address account);
    error CannotRevokeLastAdmin();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address initialTrustedSigner, address initialTreasury)
        EIP712("ProductionGradeRFQ", "1")
    {
        if (initialTrustedSigner == address(0) || initialTreasury == address(0)) {
            revert InvalidAddress();
        }
        owner = msg.sender;
        trustedSigner = initialTrustedSigner;
        treasury = initialTreasury;
        _setTrustedSignerAuthorization(initialTrustedSigner, true);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(SIGNER_ADMIN_ROLE, msg.sender);
        _grantRole(TOKEN_ADMIN_ROLE, msg.sender);
        _grantRole(TREASURY_ADMIN_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);

        emit OwnerUpdated(address(0), msg.sender);
        emit TrustedSignerUpdated(address(0), initialTrustedSigner);
        emit TreasuryUpdated(address(0), initialTreasury);
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
        _collectTokenIn(quote);
        _releaseTokenOut(quote);

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

    function grantRole(bytes32 role, address account)
        public
        override(AccessControl, IRFQSettlement)
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (account == address(0)) revert InvalidAddress();
        _grantRole(role, account);
    }

    function revokeRole(bytes32 role, address account)
        public
        override(AccessControl, IRFQSettlement)
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (account == address(0)) revert InvalidAddress();
        _revokeRole(role, account);
    }

    function hasRole(bytes32 role, address account)
        public
        view
        override(AccessControl, IRFQSettlement)
        returns (bool)
    {
        return super.hasRole(role, account);
    }

    function setTrustedSigner(address newTrustedSigner) external onlyRole(SIGNER_ADMIN_ROLE) {
        if (newTrustedSigner == address(0)) revert InvalidAddress();
        _setTrustedSignerAuthorization(newTrustedSigner, true);
        emit TrustedSignerUpdated(trustedSigner, newTrustedSigner);
        trustedSigner = newTrustedSigner;
    }

    function setTrustedSignerAuthorization(address signer, bool authorized)
        external
        onlyRole(SIGNER_ADMIN_ROLE)
    {
        if (signer == address(0)) revert InvalidAddress();
        if (!authorized && trustedSigners[signer]) {
            if (_trustedSignerCount <= 1) revert CannotRevokeLastTrustedSigner();
            if (signer == trustedSigner) revert CannotRevokePrimaryTrustedSigner();
        }
        _setTrustedSignerAuthorization(signer, authorized);
    }

    function trustedSignerCount() external view returns (uint256) {
        return _trustedSignerCount;
    }

    function setTreasury(address newTreasury) external onlyRole(TREASURY_ADMIN_ROLE) {
        if (newTreasury == address(0)) revert InvalidAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function setTokenWhitelist(address token, bool whitelisted)
        external
        onlyRole(TOKEN_ADMIN_ROLE)
    {
        if (token == address(0)) revert InvalidAddress();
        tokenWhitelist[token] = whitelisted;
        emit TokenWhitelistUpdated(token, whitelisted);
    }

    function setPaused(bool newPaused) external onlyRole(PAUSER_ROLE) {
        if (newPaused != paused()) {
            if (newPaused) {
                _pause();
            } else {
                _unpause();
            }
        }
        emit PausedUpdated(newPaused);
    }

    function paused() public view override returns (bool) {
        return super.paused();
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        address oldOwner = owner;
        emit OwnerUpdated(owner, newOwner);
        owner = newOwner;
        if (newOwner != oldOwner) {
            _grantAllAdminRoles(newOwner);
            _revokeAllAdminRoles(oldOwner);
        }
    }

    function domainSeparator() public view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function hashTypedData(bytes32 structHash) public view returns (bytes32) {
        return _hashTypedDataV4(structHash);
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
        if (quote.nonce == 0) revert InvalidNonce();
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

        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert InvalidSignatureV();

        (address recovered, ECDSA.RecoverError recoverError,) = ECDSA.tryRecover(digest, v, r, s);
        if (recoverError == ECDSA.RecoverError.InvalidSignatureS) revert InvalidSignatureS();
        if (recoverError != ECDSA.RecoverError.NoError || !trustedSigners[recovered]) {
            revert InvalidSigner();
        }
    }

    function _setTrustedSignerAuthorization(address signer, bool authorized) internal {
        bool current = trustedSigners[signer];
        if (current == authorized) return;
        if (authorized && _trustedSignerCount >= MAX_TRUSTED_SIGNERS) {
            revert TooManyTrustedSigners();
        }
        if (!authorized && _trustedSignerCount <= 1) revert CannotRevokeLastTrustedSigner();
        trustedSigners[signer] = authorized;
        if (authorized) {
            _trustedSignerCount += 1;
        } else {
            _trustedSignerCount -= 1;
        }
        emit TrustedSignerAuthorizationUpdated(signer, authorized);
    }

    function _collectTokenIn(Quote calldata quote) internal {
        IERC20 token = IERC20(quote.tokenIn);
        if (quote.tokenIn.code.length == 0) revert TransferFailed();
        uint256 userBalanceBefore = token.balanceOf(quote.user);
        uint256 treasuryBalanceBefore = token.balanceOf(treasury);

        if (!token.trySafeTransferFrom(quote.user, treasury, quote.amountIn)) {
            revert TransferFailed();
        }

        uint256 userDebit = _observedDecrease(userBalanceBefore, token.balanceOf(quote.user));
        uint256 treasuryCredit = _observedIncrease(treasuryBalanceBefore, token.balanceOf(treasury));
        if (userDebit != quote.amountIn || treasuryCredit != quote.amountIn) {
            revert InputTransferAmountMismatch(quote.amountIn, userDebit, treasuryCredit);
        }
    }

    function _releaseTokenOut(Quote calldata quote) internal {
        IERC20 token = IERC20(quote.tokenOut);
        if (quote.tokenOut.code.length == 0) revert TransferFailed();
        uint256 treasuryBalanceBefore = token.balanceOf(treasury);
        uint256 userBalanceBefore = token.balanceOf(quote.user);

        ITreasuryMinimal(treasury).release(quote.tokenOut, quote.user, quote.amountOut);

        uint256 treasuryDebit = _observedDecrease(treasuryBalanceBefore, token.balanceOf(treasury));
        uint256 userCredit = _observedIncrease(userBalanceBefore, token.balanceOf(quote.user));
        if (treasuryDebit != quote.amountOut || userCredit != quote.amountOut) {
            revert OutputTransferAmountMismatch(quote.amountOut, treasuryDebit, userCredit);
        }
    }

    function _observedDecrease(uint256 balanceBefore, uint256 balanceAfter)
        internal
        pure
        returns (uint256)
    {
        return balanceBefore > balanceAfter ? balanceBefore - balanceAfter : 0;
    }

    function _observedIncrease(uint256 balanceBefore, uint256 balanceAfter)
        internal
        pure
        returns (uint256)
    {
        return balanceAfter > balanceBefore ? balanceAfter - balanceBefore : 0;
    }

    function _checkRole(bytes32 role, address account) internal view override {
        if (!hasRole(role, account)) revert MissingRole(role, account);
    }

    function _grantAllAdminRoles(address account) internal {
        _grantRole(DEFAULT_ADMIN_ROLE, account);
        _grantRole(SIGNER_ADMIN_ROLE, account);
        _grantRole(TOKEN_ADMIN_ROLE, account);
        _grantRole(TREASURY_ADMIN_ROLE, account);
        _grantRole(PAUSER_ROLE, account);
    }

    function _revokeAllAdminRoles(address account) internal {
        _revokeRole(PAUSER_ROLE, account);
        _revokeRole(TREASURY_ADMIN_ROLE, account);
        _revokeRole(TOKEN_ADMIN_ROLE, account);
        _revokeRole(SIGNER_ADMIN_ROLE, account);
        _revokeRole(DEFAULT_ADMIN_ROLE, account);
    }

    function _grantRole(bytes32 role, address account) internal override returns (bool) {
        bool granted = super._grantRole(role, account);
        if (granted) _roleMemberCounts[role] += 1;
        return granted;
    }

    function _revokeRole(bytes32 role, address account) internal override returns (bool) {
        if (!hasRole(role, account)) return false;
        if (role == DEFAULT_ADMIN_ROLE && _roleMemberCounts[role] <= 1) {
            revert CannotRevokeLastAdmin();
        }
        bool revoked = super._revokeRole(role, account);
        if (revoked) _roleMemberCounts[role] -= 1;
        return revoked;
    }
}
