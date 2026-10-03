// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @notice Test-only stand-in for the real zkEVM rollup. Accepts every
///         withdrawal proof so bridge-level accounting (deposited amounts,
///         replay protection, payout queueing) can be exercised without a
///         real Groth16 proof. Never used in production deployments.
contract MockZkEVM {
    mapping(address => uint256) public balances;
    address public bridge;

    function depositToL2() external payable {
        require(msg.value > 0, "Amount must be > 0");
        balances[msg.sender] += msg.value;
    }

    /// @notice Test-only bridge deposit preserving the original user's identity.
    /// @dev The first bridge caller becomes the configured bridge for this mock.
    /// @param user User whose L2 balance receives the deposited value.
    function depositToL2(address user) external payable {
        if (bridge == address(0)) {
            bridge = msg.sender;
        }
        require(msg.sender == bridge, "MockZkEVM: caller is not bridge");
        require(user != address(0), "Invalid user");
        require(msg.value > 0, "Amount must be > 0");
        balances[user] += msg.value;
    }

    function withdrawFromL2(uint256 amount, bytes calldata) external {
        require(amount > 0, "Amount must be > 0");
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -= amount;
        payable(msg.sender).transfer(amount);
    }

    /// @notice Test-only bridge withdrawal preserving the original user's identity.
    /// @dev Funds are returned to the configured bridge for its user payout queue.
    /// @param user User whose L2 balance is being withdrawn.
    /// @param amount Amount to withdraw.
    /// @param proof Ignored by the test-only mock verifier path.
    function withdrawFromL2(address user, uint256 amount, bytes calldata proof) external {
        proof;
        require(msg.sender == bridge, "MockZkEVM: caller is not bridge");
        require(user != address(0), "Invalid user");
        require(amount > 0, "Amount must be > 0");
        require(balances[user] >= amount, "Insufficient balance");
        balances[user] -= amount;
        payable(msg.sender).transfer(amount);
    }

    function getBalance(address user) external view returns (uint256) {
        return balances[user];
    }
}
