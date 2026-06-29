// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Treasury } from "../src/Treasury.sol";

interface TreasuryVm {
    function prank(address caller) external;
    function expectRevert(bytes4 selector) external;
}

contract TreasuryMockERC20 {
    mapping(address account => uint256 balance) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "BALANCE");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract TreasuryFalseReturnToken {
    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }
}

contract TreasuryRevertingToken {
    function transfer(address, uint256) external pure returns (bool) {
        revert("TRANSFER_REVERTED");
    }
}

contract TreasuryReentrantToken {
    Treasury private immutable treasury;
    mapping(address account => uint256 balance) public balanceOf;
    address private reentryRecipient;
    bool private reenterOnTransfer;

    constructor(Treasury treasury_) {
        treasury = treasury_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function enableReleaseReentry(address recipient) external {
        reentryRecipient = recipient;
        reenterOnTransfer = true;
    }

    function attackRelease(address to, uint256 amount) external {
        treasury.release(address(this), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "BALANCE");
        if (reenterOnTransfer) {
            reenterOnTransfer = false;
            treasury.release(address(this), reentryRecipient, 1);
        }
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract TreasuryTest {
    TreasuryVm private constant vm =
        TreasuryVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant OWNER = address(0xA11CE);
    address private constant SETTLEMENT = address(0x5E771E);
    address private constant USER = address(0xB0B);
    address private constant NEW_OWNER = address(0xC0DE);

    Treasury private treasury;
    TreasuryMockERC20 private token;

    function setUp() public {
        treasury = new Treasury(OWNER);
        token = new TreasuryMockERC20();
        token.mint(address(treasury), 1_000 ether);

        vm.prank(OWNER);
        treasury.setSettlement(SETTLEMENT);
    }

    function testOwnerCanSetSettlementAndTransferOwnership() public {
        vm.prank(OWNER);
        treasury.setSettlement(address(0x1234));
        require(treasury.settlement() == address(0x1234), "settlement mismatch");

        vm.prank(OWNER);
        treasury.transferOwnership(NEW_OWNER);
        require(treasury.owner() == NEW_OWNER, "owner mismatch");
    }

    function testOnlyOwnerCanSetSettlement() public {
        vm.prank(USER);
        vm.expectRevert(Treasury.NotOwner.selector);
        treasury.setSettlement(address(0x1234));
    }

    function testSettlementCanReleaseFunds() public {
        vm.prank(SETTLEMENT);
        treasury.release(address(token), USER, 100 ether);

        require(token.balanceOf(USER) == 100 ether, "user balance mismatch");
        require(token.balanceOf(address(treasury)) == 900 ether, "treasury balance mismatch");
    }

    function testOnlySettlementCanReleaseFunds() public {
        vm.prank(USER);
        vm.expectRevert(Treasury.NotSettlement.selector);
        treasury.release(address(token), USER, 100 ether);
    }

    function testOwnerCanEmergencyWithdraw() public {
        vm.prank(OWNER);
        treasury.emergencyWithdraw(address(token), OWNER, 25 ether);

        require(token.balanceOf(OWNER) == 25 ether, "owner balance mismatch");
        require(token.balanceOf(address(treasury)) == 975 ether, "treasury balance mismatch");
    }

    function testRejectsInvalidTransferInputs() public {
        vm.prank(SETTLEMENT);
        vm.expectRevert(Treasury.InvalidAddress.selector);
        treasury.release(address(0), USER, 100 ether);

        vm.prank(SETTLEMENT);
        vm.expectRevert(Treasury.InvalidAddress.selector);
        treasury.release(address(token), address(0), 100 ether);

        vm.prank(SETTLEMENT);
        vm.expectRevert(Treasury.InvalidAmount.selector);
        treasury.release(address(token), USER, 0);
    }

    function testRejectsFailedTokenTransfers() public {
        TreasuryFalseReturnToken falseToken = new TreasuryFalseReturnToken();

        vm.prank(SETTLEMENT);
        vm.expectRevert(Treasury.TransferFailed.selector);
        treasury.release(address(falseToken), USER, 100 ether);

        TreasuryRevertingToken revertingToken = new TreasuryRevertingToken();

        vm.prank(OWNER);
        vm.expectRevert(Treasury.TransferFailed.selector);
        treasury.emergencyWithdraw(address(revertingToken), OWNER, 100 ether);
    }

    function testRejectsNonContractTokenTransfers() public {
        vm.prank(SETTLEMENT);
        vm.expectRevert(Treasury.TransferFailed.selector);
        treasury.release(address(0xE0A), USER, 100 ether);
    }

    function testRejectsReentrantRelease() public {
        TreasuryReentrantToken reentrantToken = new TreasuryReentrantToken(treasury);
        reentrantToken.mint(address(treasury), 100 ether);

        vm.prank(OWNER);
        treasury.setSettlement(address(reentrantToken));

        reentrantToken.enableReleaseReentry(USER);

        vm.expectRevert(Treasury.TransferFailed.selector);
        reentrantToken.attackRelease(USER, 50 ether);

        require(reentrantToken.balanceOf(USER) == 0, "user balance changed");
        require(
            reentrantToken.balanceOf(address(treasury)) == 100 ether, "treasury balance changed"
        );
    }
}
