// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { RFQSettlement } from "../src/RFQSettlement.sol";
import { IRFQSettlement } from "../src/interfaces/IRFQSettlement.sol";
import { Treasury } from "../src/Treasury.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function prank(address caller) external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData)
        external;
    function warp(uint256 timestamp) external;
}

contract MockERC20 {
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "BALANCE");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "BALANCE");
        require(allowance[from][msg.sender] >= amount, "ALLOWANCE");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract NoReturnERC20 {
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    function transfer(address to, uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "BALANCE");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
    }

    function transferFrom(address from, address to, uint256 amount) external {
        require(balanceOf[from] >= amount, "BALANCE");
        require(allowance[from][msg.sender] >= amount, "ALLOWANCE");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

contract FalseReturnERC20 {
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }
}

contract RFQSettlementTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant SIGNER_KEY = 0xA11CE;
    uint256 private constant NEW_SIGNER_KEY = 0xC0FFEE;
    uint256 private constant USER_KEY = 0xB0B;
    uint256 private constant SECP256K1N_HIGH_S =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a1;
    bytes32 private constant DEFAULT_ADMIN_ROLE = 0x00;
    bytes32 private constant SIGNER_ADMIN_ROLE = keccak256("SIGNER_ADMIN_ROLE");
    bytes32 private constant TOKEN_ADMIN_ROLE = keccak256("TOKEN_ADMIN_ROLE");
    bytes32 private constant TREASURY_ADMIN_ROLE = keccak256("TREASURY_ADMIN_ROLE");
    bytes32 private constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    RFQSettlement private settlement;
    Treasury private treasury;
    MockERC20 private tokenIn;
    MockERC20 private tokenOut;
    address private signer;
    address private user;

    event QuoteSettled(
        bytes32 indexed quoteHash,
        address indexed user,
        address indexed tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 nonce
    );

    function setUp() public {
        signer = vm.addr(SIGNER_KEY);
        user = vm.addr(USER_KEY);
        treasury = new Treasury(address(this));
        settlement = new RFQSettlement(signer, address(treasury));
        treasury.setSettlement(address(settlement));
        tokenIn = new MockERC20();
        tokenOut = new MockERC20();

        settlement.setTokenWhitelist(address(tokenIn), true);
        settlement.setTokenWhitelist(address(tokenOut), true);
        tokenIn.mint(user, 1_000 ether);
        tokenOut.mint(address(treasury), 1_000 ether);

        vm.prank(user);
        tokenIn.approve(address(settlement), type(uint256).max);
    }

    function testSubmitQuoteTransfersTokensAndConsumesNonce() public {
        IRFQSettlement.Quote memory quote = _quote(1);
        bytes memory signature = _sign(quote);

        vm.prank(user);
        uint256 amountOut = settlement.submitQuote(quote, signature);

        require(amountOut == quote.amountOut, "amount out mismatch");
        require(settlement.usedNonces(user, quote.nonce), "nonce not consumed");
        require(tokenIn.balanceOf(address(treasury)) == quote.amountIn, "tokenIn not received");
        require(tokenOut.balanceOf(user) == quote.amountOut, "tokenOut not paid");
        require(
            tokenOut.balanceOf(address(treasury)) == 1_000 ether - quote.amountOut,
            "treasury not debited"
        );
    }

    function testFuzzSubmitQuoteSettlesBoundedAmounts(
        uint256 rawAmountIn,
        uint256 rawAmountOut,
        uint256 rawMinAmountOut,
        uint256 rawNonce
    ) public {
        IRFQSettlement.Quote memory quote = _quote(_boundUint(rawNonce, 1, type(uint128).max));
        quote.amountIn = _boundUint(rawAmountIn, 1, 500 ether);
        quote.amountOut = _boundUint(rawAmountOut, 1, 500 ether);
        quote.minAmountOut = _boundUint(rawMinAmountOut, 1, quote.amountOut);
        bytes memory signature = _sign(quote);

        uint256 userTokenInBefore = tokenIn.balanceOf(user);
        uint256 userTokenOutBefore = tokenOut.balanceOf(user);
        uint256 treasuryTokenInBefore = tokenIn.balanceOf(address(treasury));
        uint256 treasuryTokenOutBefore = tokenOut.balanceOf(address(treasury));

        vm.prank(user);
        uint256 amountOut = settlement.submitQuote(quote, signature);

        require(amountOut == quote.amountOut, "fuzz amount out mismatch");
        require(settlement.usedNonces(user, quote.nonce), "fuzz nonce not consumed");
        require(
            tokenIn.balanceOf(user) == userTokenInBefore - quote.amountIn,
            "fuzz user tokenIn not debited"
        );
        require(
            tokenIn.balanceOf(address(treasury)) == treasuryTokenInBefore + quote.amountIn,
            "fuzz treasury tokenIn not credited"
        );
        require(
            tokenOut.balanceOf(user) == userTokenOutBefore + quote.amountOut,
            "fuzz user tokenOut not credited"
        );
        require(
            tokenOut.balanceOf(address(treasury)) == treasuryTokenOutBefore - quote.amountOut,
            "fuzz treasury tokenOut not debited"
        );
    }

    function testFuzzSubmitQuoteRejectsMinOutAboveAmountOutWithoutSideEffects(
        uint256 rawAmountOut,
        uint256 rawExtraMinOut,
        uint256 rawNonce
    ) public {
        IRFQSettlement.Quote memory quote = _quote(_boundUint(rawNonce, 1, type(uint128).max));
        quote.amountOut = _boundUint(rawAmountOut, 1, 500 ether);
        quote.minAmountOut = quote.amountOut + _boundUint(rawExtraMinOut, 1, 500 ether);
        bytes memory signature = _sign(quote);

        uint256 userTokenInBefore = tokenIn.balanceOf(user);
        uint256 userTokenOutBefore = tokenOut.balanceOf(user);
        uint256 treasuryTokenInBefore = tokenIn.balanceOf(address(treasury));
        uint256 treasuryTokenOutBefore = tokenOut.balanceOf(address(treasury));

        vm.prank(user);
        vm.expectRevert(RFQSettlement.AmountOutBelowMinimum.selector);
        settlement.submitQuote(quote, signature);

        require(!settlement.usedNonces(user, quote.nonce), "fuzz nonce consumed on minOut failure");
        require(tokenIn.balanceOf(user) == userTokenInBefore, "fuzz user tokenIn changed");
        require(tokenOut.balanceOf(user) == userTokenOutBefore, "fuzz user tokenOut changed");
        require(
            tokenIn.balanceOf(address(treasury)) == treasuryTokenInBefore,
            "fuzz treasury tokenIn changed"
        );
        require(
            tokenOut.balanceOf(address(treasury)) == treasuryTokenOutBefore,
            "fuzz treasury tokenOut changed"
        );
    }

    function testSubmitQuoteEmitsQuoteSettledForIndexer() public {
        IRFQSettlement.Quote memory quote = _quote(12);
        bytes32 quoteHash = settlement.hashQuote(quote);
        bytes memory signature = _sign(quote);

        vm.expectEmit(true, true, true, true);
        emit QuoteSettled(
            quoteHash,
            quote.user,
            quote.tokenIn,
            quote.tokenOut,
            quote.amountIn,
            quote.amountOut,
            quote.nonce
        );

        vm.prank(user);
        settlement.submitQuote(quote, signature);
    }

    function testSubmitQuoteRejectsReplay() public {
        IRFQSettlement.Quote memory quote = _quote(2);
        bytes memory signature = _sign(quote);

        vm.prank(user);
        settlement.submitQuote(quote, signature);

        vm.prank(user);
        vm.expectRevert(RFQSettlement.NonceAlreadyUsed.selector);
        settlement.submitQuote(quote, signature);
    }

    function testSubmitQuoteRejectsUntrustedSigner() public {
        IRFQSettlement.Quote memory quote = _quote(3);
        bytes memory signature = _signWith(USER_KEY, quote);

        vm.prank(user);
        vm.expectRevert(RFQSettlement.InvalidSigner.selector);
        settlement.submitQuote(quote, signature);
    }

    function testSubmitQuoteRejectsInvalidSignatureLength() public {
        IRFQSettlement.Quote memory quote = _quote(31);

        vm.prank(user);
        vm.expectRevert(RFQSettlement.InvalidSignatureLength.selector);
        settlement.submitQuote(quote, hex"1234");
    }

    function testSubmitQuoteRejectsInvalidSignatureV() public {
        IRFQSettlement.Quote memory quote = _quote(32);
        bytes memory signature = _signWithV(SIGNER_KEY, quote, 29);

        vm.prank(user);
        vm.expectRevert(RFQSettlement.InvalidSignatureV.selector);
        settlement.submitQuote(quote, signature);
    }

    function testSubmitQuoteRejectsHighSignatureS() public {
        IRFQSettlement.Quote memory quote = _quote(33);
        bytes memory signature =
            abi.encodePacked(bytes32(uint256(1)), bytes32(SECP256K1N_HIGH_S), uint8(27));

        vm.prank(user);
        vm.expectRevert(RFQSettlement.InvalidSignatureS.selector);
        settlement.submitQuote(quote, signature);
    }

    function testSubmitQuoteRejectsWhenPaused() public {
        settlement.setPaused(true);
        IRFQSettlement.Quote memory quote = _quote(4);

        vm.prank(user);
        vm.expectRevert(RFQSettlement.Paused.selector);
        settlement.submitQuote(quote, "");
    }

    function testOnlyOwnerCanManageWhitelist() public {
        vm.prank(user);
        _expectMissingRole(TOKEN_ADMIN_ROLE, user);
        settlement.setTokenWhitelist(address(tokenIn), false);
    }

    function testAccessControlSeparatesSignerAndTokenWhitelistRoles() public {
        address signerAdmin = address(0xA11CE01);
        address tokenAdmin = address(0xA11CE02);
        address newSigner = vm.addr(NEW_SIGNER_KEY);

        settlement.grantRole(SIGNER_ADMIN_ROLE, signerAdmin);
        settlement.grantRole(TOKEN_ADMIN_ROLE, tokenAdmin);

        vm.prank(signerAdmin);
        settlement.setTrustedSigner(newSigner);
        require(settlement.trustedSigner() == newSigner, "signer admin did not rotate signer");

        vm.prank(signerAdmin);
        _expectMissingRole(TOKEN_ADMIN_ROLE, signerAdmin);
        settlement.setTokenWhitelist(address(tokenIn), false);

        vm.prank(tokenAdmin);
        settlement.setTokenWhitelist(address(tokenIn), false);
        require(!settlement.tokenWhitelist(address(tokenIn)), "token admin did not update whitelist");

        vm.prank(tokenAdmin);
        _expectMissingRole(SIGNER_ADMIN_ROLE, tokenAdmin);
        settlement.setTrustedSigner(signer);
    }

    function testAccessControlRevocationRemovesAdminCapability() public {
        address tokenAdmin = address(0xA11CE03);

        settlement.grantRole(TOKEN_ADMIN_ROLE, tokenAdmin);
        require(
            settlement.hasRole(TOKEN_ADMIN_ROLE, tokenAdmin), "token admin role not granted"
        );

        vm.prank(tokenAdmin);
        settlement.setTokenWhitelist(address(tokenIn), false);

        settlement.revokeRole(TOKEN_ADMIN_ROLE, tokenAdmin);
        require(
            !settlement.hasRole(TOKEN_ADMIN_ROLE, tokenAdmin), "token admin role not revoked"
        );

        vm.prank(tokenAdmin);
        _expectMissingRole(TOKEN_ADMIN_ROLE, tokenAdmin);
        settlement.setTokenWhitelist(address(tokenIn), true);
    }

    function testCannotRevokeLastDefaultAdminRole() public {
        vm.expectRevert(RFQSettlement.CannotRevokeLastAdmin.selector);
        settlement.revokeRole(DEFAULT_ADMIN_ROLE, address(this));

        require(
            settlement.hasRole(DEFAULT_ADMIN_ROLE, address(this)),
            "default admin role was revoked"
        );
    }

    function testDefaultAdminCanBeRevokedAfterGrantingReplacement() public {
        address newAdmin = address(0xA11CE04);
        address tokenAdmin = address(0xA11CE05);

        settlement.grantRole(DEFAULT_ADMIN_ROLE, newAdmin);
        settlement.revokeRole(DEFAULT_ADMIN_ROLE, address(this));

        require(
            !settlement.hasRole(DEFAULT_ADMIN_ROLE, address(this)),
            "old default admin role still active"
        );
        require(
            settlement.hasRole(DEFAULT_ADMIN_ROLE, newAdmin),
            "replacement default admin missing"
        );

        _expectMissingRole(DEFAULT_ADMIN_ROLE, address(this));
        settlement.grantRole(TOKEN_ADMIN_ROLE, tokenAdmin);

        vm.prank(newAdmin);
        settlement.grantRole(TOKEN_ADMIN_ROLE, tokenAdmin);
        require(settlement.hasRole(TOKEN_ADMIN_ROLE, tokenAdmin), "new admin could not grant role");
    }

    function testOwnerCanRotateTrustedSigner() public {
        address newSigner = vm.addr(NEW_SIGNER_KEY);

        settlement.setTrustedSigner(newSigner);
        require(settlement.trustedSigner() == newSigner, "signer mismatch");

        IRFQSettlement.Quote memory quote = _quote(41);
        bytes memory oldSignature = _signWith(SIGNER_KEY, quote);

        vm.prank(user);
        vm.expectRevert(RFQSettlement.InvalidSigner.selector);
        settlement.submitQuote(quote, oldSignature);

        bytes memory newSignature = _signWith(NEW_SIGNER_KEY, quote);

        vm.prank(user);
        uint256 amountOut = settlement.submitQuote(quote, newSignature);

        require(amountOut == quote.amountOut, "rotated signer quote rejected");
    }

    function testOwnerCanRotateTreasury() public {
        Treasury newTreasury = new Treasury(address(this));
        newTreasury.setSettlement(address(settlement));
        tokenOut.mint(address(newTreasury), 1_000 ether);

        settlement.setTreasury(address(newTreasury));
        require(settlement.treasury() == address(newTreasury), "treasury mismatch");

        IRFQSettlement.Quote memory quote = _quote(42);
        bytes memory signature = _sign(quote);

        vm.prank(user);
        uint256 amountOut = settlement.submitQuote(quote, signature);

        require(amountOut == quote.amountOut, "rotated treasury quote rejected");
        require(
            tokenIn.balanceOf(address(newTreasury)) == quote.amountIn,
            "tokenIn not sent to new treasury"
        );
        require(tokenOut.balanceOf(user) == quote.amountOut, "tokenOut not paid from new treasury");
    }

    function testOnlyOwnerCanManageAdminControls() public {
        vm.prank(user);
        _expectMissingRole(PAUSER_ROLE, user);
        settlement.setPaused(true);

        vm.prank(user);
        _expectMissingRole(SIGNER_ADMIN_ROLE, user);
        settlement.setTrustedSigner(vm.addr(NEW_SIGNER_KEY));

        vm.prank(user);
        _expectMissingRole(TREASURY_ADMIN_ROLE, user);
        settlement.setTreasury(address(0x1234));

        vm.prank(user);
        vm.expectRevert(RFQSettlement.NotOwner.selector);
        settlement.transferOwnership(user);
    }

    function testOwnerCanTransferOwnershipAndNewOwnerCanPause() public {
        address newOwner = address(0xC0DE);

        settlement.transferOwnership(newOwner);
        require(settlement.owner() == newOwner, "owner mismatch");

        _expectMissingRole(PAUSER_ROLE, address(this));
        settlement.setPaused(true);

        vm.prank(newOwner);
        settlement.setPaused(true);
        require(settlement.paused(), "pause not updated");

        _expectMissingRole(SIGNER_ADMIN_ROLE, address(this));
        settlement.setTrustedSigner(signer);

        vm.prank(newOwner);
        settlement.setTrustedSigner(signer);
    }

    function testRejectsInvalidAdminAddresses() public {
        vm.expectRevert(RFQSettlement.InvalidAddress.selector);
        new RFQSettlement(address(0), address(treasury));

        vm.expectRevert(RFQSettlement.InvalidAddress.selector);
        new RFQSettlement(signer, address(0));

        vm.expectRevert(RFQSettlement.InvalidAddress.selector);
        settlement.setTrustedSigner(address(0));

        vm.expectRevert(RFQSettlement.InvalidAddress.selector);
        settlement.setTreasury(address(0));

        vm.expectRevert(RFQSettlement.InvalidAddress.selector);
        settlement.setTokenWhitelist(address(0), true);

        vm.expectRevert(RFQSettlement.InvalidAddress.selector);
        settlement.transferOwnership(address(0));

        vm.expectRevert(RFQSettlement.InvalidAddress.selector);
        settlement.grantRole(TOKEN_ADMIN_ROLE, address(0));

        vm.expectRevert(RFQSettlement.InvalidAddress.selector);
        settlement.revokeRole(TOKEN_ADMIN_ROLE, address(0));
    }

    function testSubmitQuoteRejectsExpiredQuote() public {
        vm.warp(1_000);
        IRFQSettlement.Quote memory quote = _quote(5);
        quote.deadline = block.timestamp - 1;
        bytes memory signature = _sign(quote);

        vm.prank(user);
        vm.expectRevert(RFQSettlement.QuoteExpired.selector);
        settlement.submitQuote(quote, signature);
    }

    function testSubmitQuoteRejectsWrongChainId() public {
        IRFQSettlement.Quote memory quote = _quote(6);
        quote.chainId = block.chainid + 1;
        bytes memory signature = _sign(quote);

        vm.prank(user);
        vm.expectRevert(RFQSettlement.InvalidChainId.selector);
        settlement.submitQuote(quote, signature);
    }

    function testSubmitQuoteRejectsCallerDifferentFromQuoteUser() public {
        IRFQSettlement.Quote memory quote = _quote(7);
        bytes memory signature = _sign(quote);

        vm.expectRevert(RFQSettlement.InvalidQuoteUser.selector);
        settlement.submitQuote(quote, signature);
    }

    function testSubmitQuoteRejectsUnwhitelistedToken() public {
        IRFQSettlement.Quote memory quote = _quote(8);
        settlement.setTokenWhitelist(address(tokenOut), false);
        bytes memory signature = _sign(quote);

        vm.prank(user);
        vm.expectRevert(RFQSettlement.TokenNotWhitelisted.selector);
        settlement.submitQuote(quote, signature);
    }

    function testSubmitQuoteRejectsNonContractTokenIn() public {
        address nonContractToken = address(0xE0A1);
        settlement.setTokenWhitelist(nonContractToken, true);
        IRFQSettlement.Quote memory quote = _quote(81);
        quote.tokenIn = nonContractToken;
        bytes memory signature = _sign(quote);

        vm.prank(user);
        vm.expectRevert(Treasury.TransferFailed.selector);
        settlement.submitQuote(quote, signature);
    }

    function testSubmitQuoteRejectsNonContractTokenOut() public {
        address nonContractToken = address(0xE0A2);
        settlement.setTokenWhitelist(nonContractToken, true);
        IRFQSettlement.Quote memory quote = _quote(82);
        quote.tokenOut = nonContractToken;
        bytes memory signature = _sign(quote);

        vm.prank(user);
        vm.expectRevert(RFQSettlement.TransferFailed.selector);
        settlement.submitQuote(quote, signature);
    }

    function testSubmitQuoteAcceptsNoReturnERC20Transfers() public {
        NoReturnERC20 noReturnTokenIn = new NoReturnERC20();
        NoReturnERC20 noReturnTokenOut = new NoReturnERC20();
        noReturnTokenIn.mint(user, 1_000 ether);
        noReturnTokenOut.mint(address(treasury), 1_000 ether);
        settlement.setTokenWhitelist(address(noReturnTokenIn), true);
        settlement.setTokenWhitelist(address(noReturnTokenOut), true);

        vm.prank(user);
        noReturnTokenIn.approve(address(settlement), type(uint256).max);

        IRFQSettlement.Quote memory quote = _quote(83);
        quote.tokenIn = address(noReturnTokenIn);
        quote.tokenOut = address(noReturnTokenOut);
        bytes memory signature = _sign(quote);

        vm.prank(user);
        uint256 amountOut = settlement.submitQuote(quote, signature);

        require(amountOut == quote.amountOut, "amount out mismatch");
        require(
            noReturnTokenIn.balanceOf(address(treasury)) == quote.amountIn, "tokenIn not received"
        );
        require(noReturnTokenOut.balanceOf(user) == quote.amountOut, "tokenOut not paid");
    }

    function testSubmitQuoteRejectsFalseReturnTokenInBeforeConsumingNonce() public {
        FalseReturnERC20 falseTokenIn = new FalseReturnERC20();
        falseTokenIn.mint(user, 1_000 ether);
        settlement.setTokenWhitelist(address(falseTokenIn), true);

        vm.prank(user);
        falseTokenIn.approve(address(settlement), type(uint256).max);

        IRFQSettlement.Quote memory quote = _quote(84);
        quote.tokenIn = address(falseTokenIn);
        bytes memory signature = _sign(quote);

        vm.prank(user);
        vm.expectRevert(RFQSettlement.TransferFailed.selector);
        settlement.submitQuote(quote, signature);

        require(!settlement.usedNonces(user, quote.nonce), "nonce consumed after failed transfer");
        require(tokenOut.balanceOf(user) == 0, "user received tokenOut");
    }

    function testSubmitQuoteRejectsFalseReturnTokenOutAndRollsBackTokenIn() public {
        FalseReturnERC20 falseTokenOut = new FalseReturnERC20();
        falseTokenOut.mint(address(treasury), 1_000 ether);
        settlement.setTokenWhitelist(address(falseTokenOut), true);

        IRFQSettlement.Quote memory quote = _quote(85);
        quote.tokenOut = address(falseTokenOut);
        bytes memory signature = _sign(quote);

        vm.prank(user);
        vm.expectRevert(Treasury.TransferFailed.selector);
        settlement.submitQuote(quote, signature);

        require(
            !settlement.usedNonces(user, quote.nonce),
            "nonce consumed after failed treasury release"
        );
        require(tokenIn.balanceOf(address(treasury)) == 0, "tokenIn transfer was not rolled back");
        require(falseTokenOut.balanceOf(user) == 0, "user received false-return tokenOut");
    }

    function testSubmitQuoteRejectsInvalidTokenPair() public {
        IRFQSettlement.Quote memory quote = _quote(9);
        quote.tokenOut = quote.tokenIn;
        bytes memory signature = _sign(quote);

        vm.prank(user);
        vm.expectRevert(RFQSettlement.InvalidTokenPair.selector);
        settlement.submitQuote(quote, signature);
    }

    function testSubmitQuoteRejectsAmountOutBelowMinimum() public {
        IRFQSettlement.Quote memory quote = _quote(10);
        quote.minAmountOut = quote.amountOut + 1;
        bytes memory signature = _sign(quote);

        vm.prank(user);
        vm.expectRevert(RFQSettlement.AmountOutBelowMinimum.selector);
        settlement.submitQuote(quote, signature);
    }

    function testSubmitQuoteRejectsZeroAmounts() public {
        IRFQSettlement.Quote memory quote = _quote(11);
        quote.amountIn = 0;
        bytes memory signature = _sign(quote);

        vm.prank(user);
        vm.expectRevert(RFQSettlement.InvalidAmount.selector);
        settlement.submitQuote(quote, signature);
    }

    function testSubmitQuoteRejectsZeroNonce() public {
        IRFQSettlement.Quote memory quote = _quote(0);
        bytes memory signature = _sign(quote);

        vm.prank(user);
        vm.expectRevert(RFQSettlement.InvalidNonce.selector);
        settlement.submitQuote(quote, signature);
    }

    function _quote(uint256 nonce) private view returns (IRFQSettlement.Quote memory) {
        return IRFQSettlement.Quote({
            user: user,
            tokenIn: address(tokenIn),
            tokenOut: address(tokenOut),
            amountIn: 100 ether,
            amountOut: 99 ether,
            minAmountOut: 98 ether,
            nonce: nonce,
            deadline: block.timestamp + 30 minutes,
            chainId: block.chainid
        });
    }

    function _sign(IRFQSettlement.Quote memory quote) private returns (bytes memory) {
        return _signWith(SIGNER_KEY, quote);
    }

    function _signWith(uint256 privateKey, IRFQSettlement.Quote memory quote)
        private
        returns (bytes memory)
    {
        return _signWithV(privateKey, quote, 0);
    }

    function _signWithV(uint256 privateKey, IRFQSettlement.Quote memory quote, uint8 overrideV)
        private
        returns (bytes memory)
    {
        bytes32 digest = settlement.hashTypedData(settlement.hashQuote(quote));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        if (overrideV != 0) {
            v = overrideV;
        }
        return abi.encodePacked(r, s, v);
    }

    function _expectMissingRole(bytes32 role, address account) private {
        vm.expectRevert(abi.encodeWithSelector(RFQSettlement.MissingRole.selector, role, account));
    }

    function _boundUint(uint256 value, uint256 min, uint256 max) private pure returns (uint256) {
        require(min <= max, "invalid fuzz bounds");
        return min + (value % (max - min + 1));
    }
}
