// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @notice Test-only stand-in for the real zkEVM rollup. Accepts every
///         withdrawal proof so bridge-level accounting (deposited amounts,
///         replay protection, payout queueing) can be exercised without a
///         real Groth16 proof. Never used in production deployments.
contract MockZkEVM {
    mapping(address => uint256) public balances;

    function depositToL2() external payable {
        require(msg.value > 0, "Amount must be > 0");
        balances[msg.sender] += msg.value;
    }

    function withdrawFromL2(uint256 amount, bytes calldata) external {
        require(amount > 0, "Amount must be > 0");
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -= amount;
        payable(msg.sender).transfer(amount);
    }

    function getBalance(address user) external view returns (uint256) {
        return balances[user];
    }
}
