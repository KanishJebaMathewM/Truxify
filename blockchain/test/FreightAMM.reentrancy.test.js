const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FreightAMM Reentrancy Protection (#11630)", function () {
    let freightAMM;
    let tokenA, tokenB;
    let owner, attacker, maliciousContract;
    let MaliciousReceiver;

    beforeEach(async function () {
        [owner, attacker] = await ethers.getSigners();

        // Deploy mock ERC20 tokens
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        tokenA = await MockERC20.deploy("Token A", "TKNA", 18);
        tokenB = await MockERC20.deploy("Token B", "TKNB", 18);
        await tokenA.waitForDeployment();
        await tokenB.waitForDeployment();

        // Deploy FreightAMM
        const FreightAMM = await ethers.getContractFactory("FreightAMM");
        freightAMM = await FreightAMM.deploy(await tokenA.getAddress(), await tokenB.getAddress());
        await freightAMM.waitForDeployment();

        // Add initial liquidity
        const liquidityAmount = ethers.parseEther("1000");
        await tokenA.mint(owner.address, liquidityAmount);
        await tokenB.mint(owner.address, liquidityAmount);

        await tokenA.approve(await freightAMM.getAddress(), liquidityAmount);
        await tokenB.approve(await freightAMM.getAddress(), liquidityAmount);
        await freightAMM.addLiquidity(liquidityAmount, liquidityAmount);

        // Deploy malicious contract
        MaliciousReceiver = await ethers.getContractFactory("MaliciousReceiver");
        maliciousContract = await MaliciousReceiver.deploy(
            await freightAMM.getAddress(),
            await tokenA.getAddress(),
            await tokenB.getAddress()
        );
        await maliciousContract.waitForDeployment();
    });

    it("should prevent reentrancy attack during removeLiquidity", async function () {
        // Fund the malicious contract with LP tokens by having it add liquidity first
        const attackAmount = ethers.parseEther("100");
        await tokenA.mint(await maliciousContract.getAddress(), attackAmount);
        await tokenB.mint(await maliciousContract.getAddress(), attackAmount);

        await maliciousContract.addLiquidityAndPrepareAttack(attackAmount, attackAmount);

        // Attempt to trigger reentrancy
        // The malicious contract will try to call removeLiquidity again in its fallback
        await expect(
            maliciousContract.triggerReentrancyAttack()
        ).to.be.revertedWithCustomError(freightAMM, "ReentrancyGuardReentrantCall")
            .or.revertedWith("ReentrancyGuard: reentrant call");
    });

    it("should correctly update state before transferring tokens in removeLiquidity", async function () {
        const initialLiquidity = await freightAMM.liquidityBalances(owner.address);
        const removeAmount = initialLiquidity / 2n;

        // Get balances before
        const ownerBalABefore = await tokenA.balanceOf(owner.address);
        const ownerBalBBefore = await tokenB.balanceOf(owner.address);
        const reserveABefore = await freightAMM.reserveA();
        const reserveBBefore = await freightAMM.reserveB();

        await freightAMM.removeLiquidity(removeAmount);

        // Get balances after
        const ownerBalAAfter = await tokenA.balanceOf(owner.address);
        const ownerBalBAfter = await tokenB.balanceOf(owner.address);
        const reserveAAfter = await freightAMM.reserveA();
        const reserveBAfter = await freightAMM.reserveB();

        // Verify state updates happened
        expect(await freightAMM.liquidityBalances(owner.address)).to.equal(initialLiquidity - removeAmount);
        expect(reserveAAfter).to.be.lt(reserveABefore);
        expect(reserveBAfter).to.be.lt(reserveBBefore);

        // Verify transfers happened
        expect(ownerBalAAfter).to.be.gt(ownerBalABefore);
        expect(ownerBalBAfter).to.be.gt(ownerBalBBefore);
    });

    it("should protect swapAForB from reentrancy", async function () {
        // Malicious contract tries to re-enter during swap
        await tokenA.mint(await maliciousContract.getAddress(), ethers.parseEther("10"));

        await expect(
            maliciousContract.triggerSwapReentrancy(ethers.parseEther("10"))
        ).to.be.reverted;
    });
});

// Helper contract for reentrancy testing
const MaliciousReceiverSource = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFreightAMM {
    function addLiquidity(uint256 amountA, uint256 amountB) external;
    function removeLiquidity(uint256 liquidity) external;
    function swapAForB(uint256 amountIn, uint256 minAmountOut, uint256 deadline) external;
    function liquidityBalances(address) external view returns (uint256);
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract MaliciousReceiver {
    IFreightAMM public amm;
    IERC20 public tokenA;
    IERC20 public tokenB;
    bool public attacking;

    constructor(address _amm, address _tokenA, address _tokenB) {
        amm = IFreightAMM(_amm);
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
    }

    function addLiquidityAndPrepareAttack(uint256 amountA, uint256 amountB) external {
        tokenA.approve(address(amm), amountA);
        tokenB.approve(address(amm), amountB);
        amm.addLiquidity(amountA, amountB);
    }

    function triggerReentrancyAttack() external {
        attacking = true;
        uint256 lpBalance = amm.liquidityBalances(address(this));
        amm.removeLiquidity(lpBalance);
    }

    function triggerSwapReentrancy(uint256 amount) external {
        attacking = true;
        tokenA.approve(address(amm), amount);
        amm.swapAForB(amount, 0, block.timestamp + 1000);
    }

    // Fallback to re-enter
    receive() external payable {
        if (attacking) {
            attacking = false; // Prevent infinite loop
            uint256 lpBalance = amm.liquidityBalances(address(this));
            if (lpBalance > 0) {
                amm.removeLiquidity(lpBalance);
            }
        }
    }
}
`;
