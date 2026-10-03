// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IzkEVM {
    function depositToL2() external payable;
    function depositToL2(address user) external payable;
    function withdrawFromL2(uint256 amount, bytes calldata proof) external;
    function withdrawFromL2(address user, uint256 amount, bytes calldata proof) external;
    function getBalance(address user) external view returns (uint256);
}

contract zkEVMBridge is Ownable, ReentrancyGuard {
    IzkEVM public zkEVM;
    mapping(address => uint256) public pendingWithdrawals;
    mapping(address => uint256) public depositedAmount;
    uint256 public bridgeFee = 0.001 ether;
    uint256 public collectedFees;

    event BridgeDeposit(address indexed user, uint256 amount, uint256 fee);
    event BridgeWithdraw(address indexed user, uint256 amount);
    event BridgeFeeUpdated(uint256 newFee);

    constructor(address _zkEVM) Ownable(msg.sender) {
        zkEVM = IzkEVM(_zkEVM);
    }

    function depositToL2() external payable nonReentrant {
        require(msg.value > bridgeFee, "Amount must be > fee");
        uint256 amount = msg.value - bridgeFee;

        depositedAmount[msg.sender] += amount;
        collectedFees += bridgeFee;

        // Preserve the original user address in the L2 balance.
        zkEVM.depositToL2{value: amount}(msg.sender);

        emit BridgeDeposit(msg.sender, amount, bridgeFee);
    }

    mapping(bytes32 => bool) public usedProofs;

    function withdrawFromL2(
        uint256 amount,
        bytes calldata proof
    ) external nonReentrant {
        require(proof.length > 0, "Empty proof");
        require(amount > 0, "Amount must be > 0");
        require(depositedAmount[msg.sender] >= amount, "Exceeds deposited amount");

        bytes32 proofHash = keccak256(proof);
        require(!usedProofs[proofHash], "Proof already used");
        usedProofs[proofHash] = true;

        // Pass the original user through to zkEVM so proof binding is checked
        // against the user rather than this bridge contract.
        zkEVM.withdrawFromL2(msg.sender, amount, proof);

        depositedAmount[msg.sender] -= amount;
        pendingWithdrawals[msg.sender] += amount;

        emit BridgeWithdraw(msg.sender, amount);
    }

    function claimWithdrawal() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "No pending withdrawal");

        pendingWithdrawals[msg.sender] = 0;
        payable(msg.sender).transfer(amount);
    }

    function setBridgeFee(uint256 newFee) external onlyOwner {
        bridgeFee = newFee;
        emit BridgeFeeUpdated(newFee);
    }

    function withdrawFees() external onlyOwner {
        // Only ever sweep the fees collected in depositToL2. The contract
        // balance also holds user funds queued in pendingWithdrawals, so it
        // must never be transferred in full to the owner.
        uint256 amount = collectedFees;
        require(amount > 0, "No fees to withdraw");
        collectedFees = 0;
        payable(owner()).transfer(amount);
    }

    receive() external payable {
        // Only the zkEVM rollup sends ETH back to the bridge (the amount
        // returned during withdrawFromL2, which is queued for the user).
        // Rejecting arbitrary ETH keeps stray funds from inflating the
        // balance and being mistaken for user money or fees.
        require(msg.sender == address(zkEVM), "Only zkEVM can fund the bridge");
    }
}