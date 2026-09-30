// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract AssetToken is ERC20, Pausable, Ownable {
    constructor() ERC20("Asset Token", "AST") Ownable(msg.sender) {}

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    // OpenZeppelin v5 update hook override
    function _update(
        address from,
        address to,
        uint256 value
    ) internal virtual override(ERC20) {
        super._update(from, to, value);
    }
}