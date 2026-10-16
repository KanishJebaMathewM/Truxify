// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract DAOToken is ERC20, Ownable {
    // Maximum supply cap for governance token inflation control
    uint256 public constant MAX_SUPPLY = 100_000_000 * 10**18;

    constructor() ERC20("Truxify Governance Token", "TRUX") Ownable(msg.sender) {
        _mint(msg.sender, 1000000 * 10**decimals());
    }

    function mint(address to, uint256 amount) external onlyOwner {
        require(totalSupply() + amount <= MAX_SUPPLY, "DAOToken: Max supply exceeded");
        _mint(to, amount);
    }
}
