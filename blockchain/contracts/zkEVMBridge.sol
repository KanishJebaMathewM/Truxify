// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface IzkEVM {
    function depositToL2() external payable;
    function withdrawFromL2(uint256 amount, bytes calldata proof) external;
    function getBalance(address user) external view returns (uint256);
}

contract zkEVMBridge is Ownable, ReentrancyGuard {
    IzkEVM public zkEVM;
    mapping(address => uint256) public pendingWithdrawals;
    uint256 public bridgeFee = 0.001 ether;

    event BridgeDeposit(address indexed user, uint256 amount, uint256 fee);
    event BridgeWithdraw(address indexed user, uint256 amount);
    event BridgeFeeUpdated(uint256 newFee);

    constructor(address _zkEVM) Ownable(msg.sender) {
        zkEVM = IzkEVM(_zkEVM);
    }

    function depositToL2() external payable nonReentrant {
        require(msg.value > bridgeFee, "Amount must be > fee");
        uint256 amount = msg.value - bridgeFee;

        // Deposit to L2
        zkEVM.depositToL2{value: amount}();

        emit BridgeDeposit(msg.sender, amount, bridgeFee);
    }

    function withdrawFromL2(
        uint256 amount,
        bytes calldata proof
    ) external nonReentrant {
        // Withdraw from L2
        zkEVM.withdrawFromL2(amount, proof);
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
        payable(owner()).transfer(address(this).balance);
    }
}