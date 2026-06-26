// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { RFQSettlement } from "../src/RFQSettlement.sol";
import { IRFQSettlement } from "../src/interfaces/IRFQSettlement.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function prank(address caller) external;
    function expectRevert(bytes4 selector) external;
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

contract RFQSettlementTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant SIGNER_KEY = 0xA11CE;
    uint256 private constant USER_KEY = 0xB0B;

    RFQSettlement private settlement;
    MockERC20 private tokenIn;
    MockERC20 private tokenOut;
    address private signer;
    address private user;

    function setUp() public {
        signer = vm.addr(SIGNER_KEY);
        user = vm.addr(USER_KEY);
        settlement = new RFQSettlement(signer);
        tokenIn = new MockERC20();
        tokenOut = new MockERC20();

        settlement.setTokenWhitelist(address(tokenIn), true);
        settlement.setTokenWhitelist(address(tokenOut), true);
        tokenIn.mint(user, 1_000 ether);
        tokenOut.mint(address(settlement), 1_000 ether);

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
        require(tokenIn.balanceOf(address(settlement)) == quote.amountIn, "tokenIn not received");
        require(tokenOut.balanceOf(user) == quote.amountOut, "tokenOut not paid");
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

    function testSubmitQuoteRejectsWhenPaused() public {
        settlement.setPaused(true);
        IRFQSettlement.Quote memory quote = _quote(4);

        vm.prank(user);
        vm.expectRevert(RFQSettlement.Paused.selector);
        settlement.submitQuote(quote, "");
    }

    function testOnlyOwnerCanManageWhitelist() public {
        vm.prank(user);
        vm.expectRevert(RFQSettlement.NotOwner.selector);
        settlement.setTokenWhitelist(address(tokenIn), false);
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
        bytes32 digest = settlement.hashTypedData(settlement.hashQuote(quote));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
