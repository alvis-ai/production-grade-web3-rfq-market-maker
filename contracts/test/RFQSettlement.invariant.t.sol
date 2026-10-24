// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { RFQSettlement } from "../src/RFQSettlement.sol";
import { IRFQSettlement } from "../src/interfaces/IRFQSettlement.sol";
import { Treasury } from "../src/Treasury.sol";

interface InvariantVm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function prank(address caller) external;
    function startPrank(address caller) external;
    function stopPrank() external;
    function warp(uint256 timestamp) external;
}

contract InvariantERC20 {
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;
    uint256 public totalSupply;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
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

/// @notice Drives RFQSettlement through valid settlements and adversarial calls while recording
/// ghost state that the invariant suite checks after every call sequence.
contract RFQSettlementHandler {
    InvariantVm private constant vm =
        InvariantVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant SIGNER_KEY = 0xA11CE;
    uint256 internal constant ROGUE_SIGNER_KEY = 0xBAD;
    uint256 internal constant USER_COUNT = 3;
    uint256 internal constant MAX_AMOUNT = 1_000 ether;

    RFQSettlement public immutable settlement;
    Treasury public immutable treasury;
    InvariantERC20 public immutable tokenIn;
    InvariantERC20 public immutable tokenOut;
    address public immutable admin;
    address public immutable attacker;

    address[USER_COUNT] public users;

    uint256 public ghostSettledAmountIn;
    uint256 public ghostSettledAmountOut;
    uint256 public ghostSettlementCount;
    uint256 public ghostReplaySuccesses;
    uint256 public ghostForgedSuccesses;
    uint256 public ghostPausedSuccesses;
    uint256 public ghostExpiredSuccesses;
    uint256 public ghostUnauthorizedAdminSuccesses;
    uint256 public ghostUnauthorizedReleaseSuccesses;

    mapping(address user => uint256 amount) public ghostUserTokenInDebited;
    mapping(address user => uint256 amount) public ghostUserTokenOutCredited;

    IRFQSettlement.Quote[] internal settledQuotes;
    bytes[] internal settledSignatures;
    uint256 internal nextNonce = 1;

    constructor(
        RFQSettlement settlement_,
        Treasury treasury_,
        InvariantERC20 tokenIn_,
        InvariantERC20 tokenOut_,
        address admin_,
        address[USER_COUNT] memory users_
    ) {
        settlement = settlement_;
        treasury = treasury_;
        tokenIn = tokenIn_;
        tokenOut = tokenOut_;
        admin = admin_;
        users = users_;
        attacker = vm.addr(0xDEAD);
    }

    function settleQuote(uint256 userSeed, uint256 rawAmountIn, uint256 rawAmountOut) external {
        if (settlement.paused()) return;
        address user = users[userSeed % USER_COUNT];
        uint256 amountIn = _bound(rawAmountIn, 1, MAX_AMOUNT);
        uint256 amountOut = _bound(rawAmountOut, 1, MAX_AMOUNT);
        if (tokenIn.balanceOf(user) < amountIn) return;
        if (tokenOut.balanceOf(address(treasury)) < amountOut) return;

        IRFQSettlement.Quote memory quote = _quote(user, amountIn, amountOut);
        bytes memory signature = _signWith(SIGNER_KEY, quote);

        vm.prank(user);
        settlement.submitQuote(quote, signature);

        ghostSettledAmountIn += amountIn;
        ghostSettledAmountOut += amountOut;
        ghostSettlementCount += 1;
        ghostUserTokenInDebited[user] += amountIn;
        ghostUserTokenOutCredited[user] += amountOut;
        settledQuotes.push(quote);
        settledSignatures.push(signature);
    }

    function replaySettledQuote(uint256 index) external {
        if (settledQuotes.length == 0) return;
        uint256 selected = index % settledQuotes.length;
        IRFQSettlement.Quote memory quote = settledQuotes[selected];

        vm.prank(quote.user);
        try settlement.submitQuote(quote, settledSignatures[selected]) {
            ghostReplaySuccesses += 1;
        } catch { }
    }

    function submitForgedQuote(uint256 userSeed, uint256 rawAmountOut) external {
        address user = users[userSeed % USER_COUNT];
        IRFQSettlement.Quote memory quote = _quote(user, 1, _bound(rawAmountOut, 1, MAX_AMOUNT));
        bytes memory signature = _signWith(ROGUE_SIGNER_KEY, quote);

        vm.prank(user);
        try settlement.submitQuote(quote, signature) {
            ghostForgedSuccesses += 1;
        } catch { }
    }

    function submitTamperedQuote(uint256 userSeed, uint256 rawBonus) external {
        address user = users[userSeed % USER_COUNT];
        IRFQSettlement.Quote memory quote = _quote(user, 1 ether, 1 ether);
        bytes memory signature = _signWith(SIGNER_KEY, quote);
        quote.amountOut += _bound(rawBonus, 1, MAX_AMOUNT);

        vm.prank(user);
        try settlement.submitQuote(quote, signature) {
            ghostForgedSuccesses += 1;
        } catch { }
    }

    function submitQuoteForOtherUser(uint256 victimSeed) external {
        address victim = users[victimSeed % USER_COUNT];
        IRFQSettlement.Quote memory quote = _quote(victim, 1 ether, 1 ether);
        bytes memory signature = _signWith(SIGNER_KEY, quote);

        vm.prank(attacker);
        try settlement.submitQuote(quote, signature) {
            ghostForgedSuccesses += 1;
        } catch { }
    }

    function submitWhilePaused(uint256 userSeed) external {
        if (!settlement.paused()) return;
        address user = users[userSeed % USER_COUNT];
        IRFQSettlement.Quote memory quote = _quote(user, 1, 1);
        bytes memory signature = _signWith(SIGNER_KEY, quote);

        vm.prank(user);
        try settlement.submitQuote(quote, signature) {
            ghostPausedSuccesses += 1;
        } catch { }
    }

    function submitExpiredQuote(uint256 userSeed, uint256 rawAge) external {
        address user = users[userSeed % USER_COUNT];
        IRFQSettlement.Quote memory quote = _quote(user, 1, 1);
        uint256 age = _bound(rawAge, 1, 365 days);
        if (block.timestamp <= age) return;
        quote.deadline = block.timestamp - age;
        bytes memory signature = _signWith(SIGNER_KEY, quote);

        vm.prank(user);
        try settlement.submitQuote(quote, signature) {
            ghostExpiredSuccesses += 1;
        } catch { }
    }

    function attackerAdminCall(uint256 selector, address target) external {
        vm.startPrank(attacker);
        bool succeeded;
        uint256 action = selector % 7;
        if (action == 0) {
            try settlement.setPaused(!settlement.paused()) {
                succeeded = true;
            } catch { }
        } else if (action == 1) {
            try settlement.setTrustedSigner(attacker) {
                succeeded = true;
            } catch { }
        } else if (action == 2) {
            try settlement.setTrustedSignerAuthorization(attacker, true) {
                succeeded = true;
            } catch { }
        } else if (action == 3) {
            try settlement.setTokenWhitelist(target, true) {
                succeeded = true;
            } catch { }
        } else if (action == 4) {
            try settlement.grantRole(bytes32(0), attacker) {
                succeeded = true;
            } catch { }
        } else if (action == 5) {
            try settlement.transferOwnership(attacker) {
                succeeded = true;
            } catch { }
        } else {
            try treasury.emergencyWithdraw(address(tokenOut), attacker, 1) {
                succeeded = true;
            } catch { }
        }
        vm.stopPrank();
        if (succeeded) ghostUnauthorizedAdminSuccesses += 1;
    }

    function attackerTreasuryRelease(uint256 rawAmount) external {
        vm.prank(attacker);
        try treasury.release(address(tokenOut), attacker, _bound(rawAmount, 1, MAX_AMOUNT)) {
            ghostUnauthorizedReleaseSuccesses += 1;
        } catch { }
    }

    function togglePause() external {
        bool nextPaused = !settlement.paused();
        vm.prank(admin);
        settlement.setPaused(nextPaused);
    }

    function advanceTime(uint256 rawSeconds) external {
        vm.warp(block.timestamp + _bound(rawSeconds, 1, 7 days));
    }

    function settledQuoteCount() external view returns (uint256) {
        return settledQuotes.length;
    }

    function settledQuoteAt(uint256 index) external view returns (IRFQSettlement.Quote memory) {
        return settledQuotes[index];
    }

    function userAt(uint256 index) external view returns (address) {
        return users[index];
    }

    function _quote(address user, uint256 amountIn, uint256 amountOut)
        internal
        returns (IRFQSettlement.Quote memory)
    {
        uint256 nonce = nextNonce;
        nextNonce += 1;
        return IRFQSettlement.Quote({
            user: user,
            tokenIn: address(tokenIn),
            tokenOut: address(tokenOut),
            amountIn: amountIn,
            amountOut: amountOut,
            minAmountOut: amountOut,
            nonce: nonce,
            deadline: block.timestamp + 30 minutes,
            chainId: block.chainid
        });
    }

    function _signWith(uint256 privateKey, IRFQSettlement.Quote memory quote)
        internal
        returns (bytes memory)
    {
        bytes32 digest = settlement.hashTypedData(settlement.hashQuote(quote));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _bound(uint256 value, uint256 min, uint256 max) internal pure returns (uint256) {
        return min + (value % (max - min + 1));
    }
}

/// @notice Stateful invariant suite for settlement custody, replay protection and admin controls.
contract RFQSettlementInvariantTest {
    InvariantVm private constant vm =
        InvariantVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant SIGNER_KEY = 0xA11CE;
    uint256 private constant USER_BALANCE = 50_000 ether;
    uint256 private constant TREASURY_BALANCE = 100_000 ether;

    RFQSettlement private settlement;
    Treasury private treasury;
    InvariantERC20 private tokenIn;
    InvariantERC20 private tokenOut;
    RFQSettlementHandler private handler;
    address private signer;

    address[] private targets;

    function setUp() public {
        signer = vm.addr(SIGNER_KEY);
        treasury = new Treasury(address(this));
        settlement = new RFQSettlement(signer, address(treasury));
        treasury.setSettlement(address(settlement));
        tokenIn = new InvariantERC20();
        tokenOut = new InvariantERC20();
        settlement.setTokenWhitelist(address(tokenIn), true);
        settlement.setTokenWhitelist(address(tokenOut), true);
        tokenOut.mint(address(treasury), TREASURY_BALANCE);

        address[3] memory users = [vm.addr(0xB0B), vm.addr(0xCAFE), vm.addr(0xF00D)];
        for (uint256 i = 0; i < users.length; i++) {
            tokenIn.mint(users[i], USER_BALANCE);
            vm.prank(users[i]);
            tokenIn.approve(address(settlement), type(uint256).max);
        }

        handler = new RFQSettlementHandler(
            settlement, treasury, tokenIn, tokenOut, address(this), users
        );
        targets.push(address(handler));
    }

    function targetContracts() public view returns (address[] memory) {
        return targets;
    }

    function invariantTokenSupplyIsConserved() public view {
        uint256 tokenInHeld = tokenIn.balanceOf(address(treasury)) + _sumUserBalances(tokenIn);
        uint256 tokenOutHeld = tokenOut.balanceOf(address(treasury)) + _sumUserBalances(tokenOut);
        require(tokenInHeld == tokenIn.totalSupply(), "tokenIn leaked");
        require(tokenOutHeld == tokenOut.totalSupply(), "tokenOut leaked");
    }

    function invariantTreasuryMatchesSettledFlow() public view {
        require(
            tokenIn.balanceOf(address(treasury)) == handler.ghostSettledAmountIn(),
            "treasury tokenIn mismatch"
        );
        require(
            tokenOut.balanceOf(address(treasury))
                == TREASURY_BALANCE - handler.ghostSettledAmountOut(),
            "treasury tokenOut mismatch"
        );
    }

    function invariantUserBalancesMatchSettledFlow() public view {
        for (uint256 i = 0; i < 3; i++) {
            address user = handler.userAt(i);
            require(
                tokenIn.balanceOf(user) == USER_BALANCE - handler.ghostUserTokenInDebited(user),
                "user tokenIn mismatch"
            );
            require(
                tokenOut.balanceOf(user) == handler.ghostUserTokenOutCredited(user),
                "user tokenOut mismatch"
            );
        }
    }

    function invariantSettlementNeverCustodiesFunds() public view {
        require(tokenIn.balanceOf(address(settlement)) == 0, "settlement holds tokenIn");
        require(tokenOut.balanceOf(address(settlement)) == 0, "settlement holds tokenOut");
    }

    function invariantSettledNoncesAreConsumed() public view {
        uint256 count = handler.settledQuoteCount();
        for (uint256 i = 0; i < count; i++) {
            IRFQSettlement.Quote memory quote = handler.settledQuoteAt(i);
            require(settlement.usedNonces(quote.user, quote.nonce), "settled nonce not consumed");
        }
    }

    function invariantAdversarialCallsNeverSucceed() public view {
        require(handler.ghostReplaySuccesses() == 0, "replay settled");
        require(handler.ghostForgedSuccesses() == 0, "forged quote settled");
        require(handler.ghostPausedSuccesses() == 0, "settled while paused");
        require(handler.ghostExpiredSuccesses() == 0, "expired quote settled");
        require(handler.ghostUnauthorizedAdminSuccesses() == 0, "unauthorized admin call");
        require(handler.ghostUnauthorizedReleaseSuccesses() == 0, "unauthorized release");
    }

    function invariantPrivilegedConfigurationIsStable() public view {
        address attacker = handler.attacker();
        require(settlement.owner() == address(this), "owner changed");
        require(settlement.trustedSigner() == signer, "primary signer changed");
        require(settlement.trustedSigners(signer), "primary signer deauthorized");
        require(!settlement.trustedSigners(attacker), "attacker became signer");
        require(settlement.trustedSignerCount() == 1, "signer set changed");
        require(settlement.treasury() == address(treasury), "treasury changed");
        require(treasury.settlement() == address(settlement), "treasury binding changed");
        require(treasury.owner() == address(this), "treasury owner changed");
        require(!settlement.hasRole(bytes32(0), attacker), "attacker became admin");
        require(settlement.tokenWhitelistCount() == 2, "whitelist changed");
    }

    function _sumUserBalances(InvariantERC20 token) private view returns (uint256 total) {
        for (uint256 i = 0; i < 3; i++) {
            total += token.balanceOf(handler.userAt(i));
        }
    }
}
