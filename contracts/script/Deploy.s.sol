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

contract DeployRFQSettlement {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    error InvalidTrustedSigner();
    error EmptyTokenWhitelist();
    error InvalidWhitelistToken();
    error DuplicateWhitelistToken(address token);

    struct Deployment {
        RFQSettlement settlement;
        Treasury treasury;
        address trustedSigner;
        address[] tokenWhitelist;
    }

    function run() external returns (Deployment memory deployment) {
        address trustedSigner = vm.envAddress("RFQ_TRUSTED_SIGNER");
        address[] memory tokenWhitelist = readTokenWhitelist();

        vm.startBroadcast();
        deployment = deploy(trustedSigner, tokenWhitelist);
        vm.stopBroadcast();
    }

    function deploy(address trustedSigner, address[] memory tokenWhitelist)
        public
        returns (Deployment memory deployment)
    {
        validateDeploymentConfig(trustedSigner, tokenWhitelist);

        Treasury treasury = new Treasury(address(this));
        RFQSettlement settlement = new RFQSettlement(trustedSigner, address(treasury));
        treasury.setSettlement(address(settlement));

        for (uint256 index = 0; index < tokenWhitelist.length; index += 1) {
            settlement.setTokenWhitelist(tokenWhitelist[index], true);
        }

        return Deployment({
            settlement: settlement,
            treasury: treasury,
            trustedSigner: trustedSigner,
            tokenWhitelist: tokenWhitelist
        });
    }

    function validateDeploymentConfig(address trustedSigner, address[] memory tokenWhitelist)
        public
        pure
    {
        if (trustedSigner == address(0)) revert InvalidTrustedSigner();
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
}
