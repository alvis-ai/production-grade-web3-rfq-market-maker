// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { DeployRFQSettlement } from "../script/Deploy.s.sol";

contract DeployRFQSettlementTest {
    function testDeployInitializesTrustedSignerAndWhitelist() public {
        DeployRFQSettlement script = new DeployRFQSettlement();
        address trustedSigner = address(0xA11CE);
        address[] memory tokens = new address[](2);
        tokens[0] = address(0x1001);
        tokens[1] = address(0x1002);

        DeployRFQSettlement.Deployment memory deployment = script.deploy(trustedSigner, tokens);

        require(address(deployment.settlement) != address(0), "settlement not deployed");
        require(address(deployment.treasury) != address(0), "treasury not deployed");
        require(deployment.settlement.owner() == address(script), "owner mismatch");
        require(deployment.treasury.owner() == address(script), "treasury owner mismatch");
        require(
            deployment.treasury.settlement() == address(deployment.settlement),
            "treasury settlement mismatch"
        );
        require(
            deployment.settlement.treasury() == address(deployment.treasury),
            "settlement treasury mismatch"
        );
        require(deployment.settlement.trustedSigner() == trustedSigner, "trusted signer mismatch");
        require(deployment.settlement.tokenWhitelist(tokens[0]), "token 0 not whitelisted");
        require(deployment.settlement.tokenWhitelist(tokens[1]), "token 1 not whitelisted");
    }

    function testDeployRejectsUnsafeDeploymentConfig() public {
        DeployRFQSettlement script = new DeployRFQSettlement();
        address trustedSigner = address(0xA11CE);
        address[] memory tokens = new address[](2);
        tokens[0] = address(0x1001);
        tokens[1] = address(0x1002);

        address[] memory emptyTokens = new address[](0);
        _expectInvalidTrustedSigner(script, tokens);
        _expectEmptyTokenWhitelist(script, trustedSigner, emptyTokens);

        tokens[1] = address(0);
        _expectInvalidWhitelistToken(script, trustedSigner, tokens);

        tokens[1] = tokens[0];
        _expectDuplicateWhitelistToken(script, trustedSigner, tokens);
    }

    function _expectInvalidTrustedSigner(
        DeployRFQSettlement script,
        address[] memory tokens
    ) private {
        try script.deploy(address(0), tokens) {
            revert("expected invalid trusted signer");
        } catch (bytes memory reason) {
            require(
                _selector(reason) == DeployRFQSettlement.InvalidTrustedSigner.selector,
                "invalid trusted signer selector mismatch"
            );
        }
    }

    function _expectEmptyTokenWhitelist(
        DeployRFQSettlement script,
        address trustedSigner,
        address[] memory tokens
    ) private {
        try script.deploy(trustedSigner, tokens) {
            revert("expected empty token whitelist");
        } catch (bytes memory reason) {
            require(
                _selector(reason) == DeployRFQSettlement.EmptyTokenWhitelist.selector,
                "empty token whitelist selector mismatch"
            );
        }
    }

    function _expectInvalidWhitelistToken(
        DeployRFQSettlement script,
        address trustedSigner,
        address[] memory tokens
    ) private {
        try script.deploy(trustedSigner, tokens) {
            revert("expected invalid whitelist token");
        } catch (bytes memory reason) {
            require(
                _selector(reason) == DeployRFQSettlement.InvalidWhitelistToken.selector,
                "invalid whitelist token selector mismatch"
            );
        }
    }

    function _expectDuplicateWhitelistToken(
        DeployRFQSettlement script,
        address trustedSigner,
        address[] memory tokens
    ) private {
        try script.deploy(trustedSigner, tokens) {
            revert("expected duplicate whitelist token");
        } catch (bytes memory reason) {
            require(
                _selector(reason) == DeployRFQSettlement.DuplicateWhitelistToken.selector,
                "duplicate whitelist token selector mismatch"
            );
        }
    }

    function _selector(bytes memory reason) private pure returns (bytes4 selector) {
        require(reason.length >= 4, "missing selector");
        assembly {
            selector := mload(add(reason, 0x20))
        }
    }
}
