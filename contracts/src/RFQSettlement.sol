// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IRFQSettlement } from "./interfaces/IRFQSettlement.sol";
import { SafeERC20 } from "./libraries/SafeERC20.sol";

interface ITreasuryMinimal {
    function release(address token, address to, uint256 amount) external;
}

/// @notice RFQ settlement contract for validating EIP-712 signed quotes and settling token flows.
/// @dev This dependency-free implementation mirrors the intended OpenZeppelin production surface:
/// EIP712, SafeERC20, ReentrancyGuard, Pausable, and role-gated administrative controls.
contract RFQSettlement is IRFQSettlement {
    using SafeERC20 for address;

    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "Quote(address user,address tokenIn,address tokenOut,uint256 amountIn,uint256 amountOut,uint256 minAmountOut,uint256 nonce,uint256 deadline,uint256 chainId)"
    );
    bytes32 public constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 public constant NAME_HASH = keccak256("ProductionGradeRFQ");
    bytes32 public constant VERSION_HASH = keccak256("1");
    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;
    bytes32 public constant SIGNER_ADMIN_ROLE = keccak256("SIGNER_ADMIN_ROLE");
    bytes32 public constant TOKEN_ADMIN_ROLE = keccak256("TOKEN_ADMIN_ROLE");
    bytes32 public constant TREASURY_ADMIN_ROLE = keccak256("TREASURY_ADMIN_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private constant _SECP256K1N_HALF =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    address public owner;
    address public trustedSigner;
    address public treasury;
    bool public paused;
    mapping(address token => bool whitelisted) public tokenWhitelist;
    mapping(address user => mapping(uint256 nonce => bool used)) public usedNonces;
    mapping(bytes32 role => mapping(address account => bool granted)) private _roles;
    mapping(bytes32 role => uint256 count) private _roleMemberCounts;

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
    error InvalidNonce();
    error AmountOutBelowMinimum();
    error TransferFailed();
    error MissingRole(bytes32 role, address account);
    error CannotRevokeLastAdmin();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRole(bytes32 role) {
        _checkRole(role, msg.sender);
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

    constructor(address initialTrustedSigner, address initialTreasury) {
        if (initialTrustedSigner == address(0) || initialTreasury == address(0)) {
            revert InvalidAddress();
        }
        owner = msg.sender;
        trustedSigner = initialTrustedSigner;
        treasury = initialTreasury;
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
        quote.tokenIn.safeTransferFrom(quote.user, treasury, quote.amountIn);
        ITreasuryMinimal(treasury).release(quote.tokenOut, quote.user, quote.amountOut);

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

    function grantRole(bytes32 role, address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (account == address(0)) revert InvalidAddress();
        _grantRole(role, account);
    }

    function revokeRole(bytes32 role, address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (account == address(0)) revert InvalidAddress();
        _revokeRole(role, account);
    }

    function hasRole(bytes32 role, address account) external view returns (bool) {
        return _roles[role][account];
    }

    function setTrustedSigner(address newTrustedSigner) external onlyRole(SIGNER_ADMIN_ROLE) {
        if (newTrustedSigner == address(0)) revert InvalidAddress();
        emit TrustedSignerUpdated(trustedSigner, newTrustedSigner);
        trustedSigner = newTrustedSigner;
    }

    function setTreasury(address newTreasury) external onlyRole(TREASURY_ADMIN_ROLE) {
        if (newTreasury == address(0)) revert InvalidAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function setTokenWhitelist(address token, bool whitelisted) external onlyRole(TOKEN_ADMIN_ROLE) {
        if (token == address(0)) revert InvalidAddress();
        tokenWhitelist[token] = whitelisted;
        emit TokenWhitelistUpdated(token, whitelisted);
    }

    function setPaused(bool newPaused) external onlyRole(PAUSER_ROLE) {
        paused = newPaused;
        emit PausedUpdated(newPaused);
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

        if (uint256(s) > _SECP256K1N_HALF) revert InvalidSignatureS();
        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert InvalidSignatureV();

        address recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0) || recovered != trustedSigner) revert InvalidSigner();
    }

    function _checkRole(bytes32 role, address account) internal view {
        if (!_roles[role][account]) revert MissingRole(role, account);
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

    function _grantRole(bytes32 role, address account) internal {
        if (_roles[role][account]) return;
        _roles[role][account] = true;
        _roleMemberCounts[role] += 1;
        emit RoleGranted(role, account, msg.sender);
    }

    function _revokeRole(bytes32 role, address account) internal {
        if (!_roles[role][account]) return;
        if (role == DEFAULT_ADMIN_ROLE && _roleMemberCounts[role] <= 1) {
            revert CannotRevokeLastAdmin();
        }
        _roles[role][account] = false;
        _roleMemberCounts[role] -= 1;
        emit RoleRevoked(role, account, msg.sender);
    }
}
