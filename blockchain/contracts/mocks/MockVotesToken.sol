// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Test-only governance token implementing the IVotes surface that
///      TruxifyUpgradeable uses (getPastVotes / getPastTotalSupply).
///      Snapshot-less: past lookups return current balances, which is fine for
///      tests because balances are not moved between proposal snapshot and
///      voting. Note OZ ERC20Votes.getPastVotes reverts when probed at the
///      pending block (ERC5805FutureLookup), which setGovernanceToken's
///      configuration-time staticcall would hit — hence this lenient mock.
contract MockVotesToken is ERC20 {
    constructor(uint256 supply) ERC20("Mock Votes", "MVOTE") {
        _mint(msg.sender, supply);
    }

    function getPastVotes(address account, uint256) external view returns (uint256) {
        return balanceOf(account);
    }

    function getPastTotalSupply(uint256) external view returns (uint256) {
        return totalSupply();
    }
}
