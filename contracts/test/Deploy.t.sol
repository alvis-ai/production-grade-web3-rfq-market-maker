// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { DeployRFQSettlement } from "../script/Deploy.s.sol";

contract DeployRFQSettlementTest {
    function testDeployAtomicallyConfiguresStackAndTransfersAdministration() public {
        DeployRFQSettlement script = new DeployRFQSettlement();
        address trustedSigner = address(0xA11CE);
        address contractAdmin = address(0xAD11);
        address[] memory tokens = _tokens();

        DeployRFQSettlement.Deployment memory deployment =
            script.deploy(trustedSigner, contractAdmin, tokens);

        require(address(deployment.settlement) != address(0), "settlement not deployed");
        require(address(deployment.treasury) != address(0), "treasury not deployed");
        require(address(deployment.factory) != address(0), "factory not deployed");
        require(deployment.contractAdmin == contractAdmin, "admin metadata mismatch");
        require(deployment.settlement.owner() == contractAdmin, "owner mismatch");
        require(deployment.treasury.owner() == contractAdmin, "treasury owner mismatch");
        _assertRoleHandoff(deployment, deployment.settlement.DEFAULT_ADMIN_ROLE(), contractAdmin);
        _assertRoleHandoff(deployment, deployment.settlement.SIGNER_ADMIN_ROLE(), contractAdmin);
        _assertRoleHandoff(deployment, deployment.settlement.TOKEN_ADMIN_ROLE(), contractAdmin);
        _assertRoleHandoff(deployment, deployment.settlement.TREASURY_ADMIN_ROLE(), contractAdmin);
        _assertRoleHandoff(deployment, deployment.settlement.PAUSER_ROLE(), contractAdmin);
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

    function testDeployRejectsUnsafeDeploymentConfigBeforeCreatingFactory() public {
        DeployRFQSettlement script = new DeployRFQSettlement();
        address trustedSigner = address(0xA11CE);
        address[] memory tokens = _tokens();

        _expectInvalidTrustedSigner(script, tokens);
        _expectInvalidContractAdmin(script, trustedSigner, tokens);
        _expectEmptyTokenWhitelist(script, trustedSigner, new address[](0));

        tokens[1] = address(0);
        _expectInvalidWhitelistToken(script, trustedSigner, tokens);

        tokens[1] = tokens[0];
        _expectDuplicateWhitelistToken(script, trustedSigner, tokens);
    }

    function _expectInvalidTrustedSigner(DeployRFQSettlement script, address[] memory tokens)
        private
    {
        try script.deploy(address(0), address(this), tokens) {
            revert("expected invalid trusted signer");
        } catch (bytes memory reason) {
            require(
                _selector(reason) == DeployRFQSettlement.InvalidTrustedSigner.selector,
                "invalid trusted signer selector mismatch"
            );
        }
    }

    function _expectInvalidContractAdmin(
        DeployRFQSettlement script,
        address trustedSigner,
        address[] memory tokens
    ) private {
        try script.deploy(trustedSigner, address(0), tokens) {
            revert("expected invalid contract admin");
        } catch (bytes memory reason) {
            require(
                _selector(reason) == DeployRFQSettlement.InvalidContractAdmin.selector,
                "invalid contract admin selector mismatch"
            );
        }
    }

    function _expectEmptyTokenWhitelist(
        DeployRFQSettlement script,
        address trustedSigner,
        address[] memory tokens
    ) private {
        try script.deploy(trustedSigner, address(this), tokens) {
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
        try script.deploy(trustedSigner, address(this), tokens) {
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
        try script.deploy(trustedSigner, address(this), tokens) {
            revert("expected duplicate whitelist token");
        } catch (bytes memory reason) {
            require(
                _selector(reason) == DeployRFQSettlement.DuplicateWhitelistToken.selector,
                "duplicate whitelist token selector mismatch"
            );
        }
    }

    function _tokens() private pure returns (address[] memory tokens) {
        tokens = new address[](2);
        tokens[0] = address(0x1001);
        tokens[1] = address(0x1002);
    }

    function _assertRoleHandoff(
        DeployRFQSettlement.Deployment memory deployment,
        bytes32 role,
        address contractAdmin
    ) private view {
        require(deployment.settlement.hasRole(role, contractAdmin), "admin role not transferred");
        require(
            !deployment.settlement.hasRole(role, address(deployment.factory)),
            "factory retained admin role"
        );
    }

    function _selector(bytes memory reason) private pure returns (bytes4 selector) {
        require(reason.length >= 4, "missing selector");
        assembly {
            selector := mload(add(reason, 0x20))
        }
    }
}
