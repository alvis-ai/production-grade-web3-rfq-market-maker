// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Mintable ERC-20 used only by the local Anvil settlement integration test.
contract LocalE2EToken is ERC20 {
    constructor(string memory tokenName, string memory tokenSymbol)
        ERC20(tokenName, tokenSymbol)
    { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
