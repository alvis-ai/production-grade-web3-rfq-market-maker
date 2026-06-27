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
        require(deployment.settlement.owner() == address(script), "owner mismatch");
        require(deployment.settlement.trustedSigner() == trustedSigner, "trusted signer mismatch");
        require(deployment.settlement.tokenWhitelist(tokens[0]), "token 0 not whitelisted");
        require(deployment.settlement.tokenWhitelist(tokens[1]), "token 1 not whitelisted");
    }
}
