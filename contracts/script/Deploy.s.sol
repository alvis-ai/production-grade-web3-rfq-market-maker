// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { RFQSettlement } from "../src/RFQSettlement.sol";
import { Treasury } from "../src/Treasury.sol";

interface Vm {
    function envAddress(string calldata name) external view returns (address);
    function envOr(string calldata name, string calldata defaultValue)
        external
        view
        returns (string memory);
    function parseJsonAddressArray(string calldata json, string calldata key)
        external
        view
        returns (address[] memory);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Atomically creates and configures one RFQ settlement stack.
/// @dev The factory temporarily owns both contracts within this transaction, then relinquishes all
/// administrative roles to contractAdmin before returning.
contract RFQDeploymentFactory {
    error InvalidTrustedSigner();
    error InvalidContractAdmin();
    error EmptyTokenWhitelist();
    error InvalidWhitelistToken();
    error DuplicateWhitelistToken(address token);
    error DeploymentInvariantViolation();

    struct Deployment {
        RFQSettlement settlement;
        Treasury treasury;
        address trustedSigner;
        address contractAdmin;
        address[] tokenWhitelist;
    }

    event DeploymentCompleted(
        address indexed settlement,
        address indexed treasury,
        address indexed contractAdmin,
        address trustedSigner
    );

    function deploy(address trustedSigner, address contractAdmin, address[] calldata tokenWhitelist)
        external
        returns (Deployment memory deployment)
    {
        _validateDeploymentConfig(trustedSigner, contractAdmin, tokenWhitelist);

        Treasury treasury = new Treasury(address(this));
        RFQSettlement settlement = new RFQSettlement(trustedSigner, address(treasury));
        treasury.setSettlement(address(settlement));

        for (uint256 index = 0; index < tokenWhitelist.length; index += 1) {
            settlement.setTokenWhitelist(tokenWhitelist[index], true);
        }

        settlement.transferOwnership(contractAdmin);
        treasury.transferOwnership(contractAdmin);
        _assertDeploymentInvariants(settlement, treasury, contractAdmin, tokenWhitelist);

        emit DeploymentCompleted(
            address(settlement), address(treasury), contractAdmin, trustedSigner
        );
        return Deployment({
            settlement: settlement,
            treasury: treasury,
            trustedSigner: trustedSigner,
            contractAdmin: contractAdmin,
            tokenWhitelist: tokenWhitelist
        });
    }

    function _validateDeploymentConfig(
        address trustedSigner,
        address contractAdmin,
        address[] calldata tokenWhitelist
    ) private pure {
        if (trustedSigner == address(0)) revert InvalidTrustedSigner();
        if (contractAdmin == address(0)) revert InvalidContractAdmin();
        if (tokenWhitelist.length == 0) revert EmptyTokenWhitelist();

        for (uint256 index = 0; index < tokenWhitelist.length; index += 1) {
            address token = tokenWhitelist[index];
            if (token == address(0)) revert InvalidWhitelistToken();
            for (uint256 cursor = 0; cursor < index; cursor += 1) {
                if (tokenWhitelist[cursor] == token) revert DuplicateWhitelistToken(token);
            }
        }
    }

    function _assertDeploymentInvariants(
        RFQSettlement settlement,
        Treasury treasury,
        address contractAdmin,
        address[] calldata tokenWhitelist
    ) private view {
        if (
            settlement.owner() != contractAdmin || treasury.owner() != contractAdmin
                || treasury.settlement() != address(settlement)
                || settlement.treasury() != address(treasury)
        ) {
            revert DeploymentInvariantViolation();
        }
        _assertRoleHandoff(settlement, settlement.DEFAULT_ADMIN_ROLE(), contractAdmin);
        _assertRoleHandoff(settlement, settlement.SIGNER_ADMIN_ROLE(), contractAdmin);
        _assertRoleHandoff(settlement, settlement.TOKEN_ADMIN_ROLE(), contractAdmin);
        _assertRoleHandoff(settlement, settlement.TREASURY_ADMIN_ROLE(), contractAdmin);
        _assertRoleHandoff(settlement, settlement.PAUSER_ROLE(), contractAdmin);
        for (uint256 index = 0; index < tokenWhitelist.length; index += 1) {
            if (!settlement.tokenWhitelist(tokenWhitelist[index])) {
                revert DeploymentInvariantViolation();
            }
        }
    }

    function _assertRoleHandoff(RFQSettlement settlement, bytes32 role, address contractAdmin)
        private
        view
    {
        if (!settlement.hasRole(role, contractAdmin) || settlement.hasRole(role, address(this))) {
            revert DeploymentInvariantViolation();
        }
    }
}

contract DeployRFQSettlement {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    error InvalidTrustedSigner();
    error InvalidContractAdmin();
    error EmptyTokenWhitelist();
    error InvalidWhitelistToken();
    error DuplicateWhitelistToken(address token);

    struct Deployment {
        RFQSettlement settlement;
        Treasury treasury;
        RFQDeploymentFactory factory;
        address trustedSigner;
        address contractAdmin;
        address[] tokenWhitelist;
    }

    function run() external returns (Deployment memory deployment) {
        address trustedSigner = vm.envAddress("RFQ_TRUSTED_SIGNER");
        address contractAdmin = vm.envAddress("RFQ_CONTRACT_ADMIN");
        address[] memory tokenWhitelist = readTokenWhitelist();
        validateDeploymentConfig(trustedSigner, contractAdmin, tokenWhitelist);

        vm.startBroadcast();
        deployment = _deployWithFactory(trustedSigner, contractAdmin, tokenWhitelist);
        vm.stopBroadcast();
    }

    function deploy(address trustedSigner, address contractAdmin, address[] memory tokenWhitelist)
        public
        returns (Deployment memory deployment)
    {
        validateDeploymentConfig(trustedSigner, contractAdmin, tokenWhitelist);
        return _deployWithFactory(trustedSigner, contractAdmin, tokenWhitelist);
    }

    function validateDeploymentConfig(
        address trustedSigner,
        address contractAdmin,
        address[] memory tokenWhitelist
    ) public pure {
        if (trustedSigner == address(0)) revert InvalidTrustedSigner();
        if (contractAdmin == address(0)) revert InvalidContractAdmin();
        if (tokenWhitelist.length == 0) revert EmptyTokenWhitelist();

        for (uint256 index = 0; index < tokenWhitelist.length; index += 1) {
            address token = tokenWhitelist[index];
            if (token == address(0)) revert InvalidWhitelistToken();
            for (uint256 cursor = 0; cursor < index; cursor += 1) {
                if (tokenWhitelist[cursor] == token) revert DuplicateWhitelistToken(token);
            }
        }
    }

    function readTokenWhitelist() public view returns (address[] memory tokenWhitelist) {
        string memory json = vm.envOr("RFQ_TOKEN_WHITELIST_JSON", '{"tokens":[]}');
        return vm.parseJsonAddressArray(json, ".tokens");
    }

    function _deployWithFactory(
        address trustedSigner,
        address contractAdmin,
        address[] memory tokenWhitelist
    ) private returns (Deployment memory deployment) {
        RFQDeploymentFactory factory = new RFQDeploymentFactory();
        RFQDeploymentFactory.Deployment memory result =
            factory.deploy(trustedSigner, contractAdmin, tokenWhitelist);
        return Deployment({
            settlement: result.settlement,
            treasury: result.treasury,
            factory: factory,
            trustedSigner: result.trustedSigner,
            contractAdmin: result.contractAdmin,
            tokenWhitelist: result.tokenWhitelist
        });
    }
}
