const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("FreightAMM Slippage & Deadline Protection (#11630)", function () {
    let freightAMM;
    let tokenA, tokenB;
    let owner, user;

    beforeEach(async function () {
        [owner, user] = await ethers.getSigners();

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        tokenA = await MockERC20.deploy("Token A", "TKNA", 18);
        tokenB = await MockERC20.deploy("Token B", "TKNB", 18);
        await tokenA.waitForDeployment();
        await tokenB.waitForDeployment();

        const FreightAMM = await ethers.getContractFactory("FreightAMM");
        freightAMM = await FreightAMM.deploy(await tokenA.getAddress(), await tokenB.getAddress());
        await freightAMM.waitForDeployment();

        // Add large liquidity
        const liquidity = ethers.parseEther("10000");
        await tokenA.mint(owner.address, liquidity);
        await tokenB.mint(owner.address, liquidity);
        await tokenA.approve(await freightAMM.getAddress(), liquidity);
        await tokenB.approve(await freightAMM.getAddress(), liquidity);
        await freightAMM.addLiquidity(liquidity, liquidity);

        // Fund user for swaps
        await tokenA.mint(user.address, ethers.parseEther("1000"));
        await tokenA.connect(user).approve(await freightAMM.getAddress(), ethers.parseEther("1000"));
    });

    describe("Slippage Protection (minAmountOut)", function () {
        it("should revert swap if output is less than minAmountOut", async function () {
            const amountIn = ethers.parseEther("100");

            // Calculate expected output (approx 99 tokens due to 0.3% fee and price impact)
            // We set minAmountOut unreasonably high to force a revert
            const unrealisticMinOut = ethers.parseEther("200");
            const deadline = (await time.latest()) + 3600;

            await expect(
                freightAMM.connect(user).swapAForB(amountIn, unrealisticMinOut, deadline)
            ).to.be.revertedWith("Slippage tolerance exceeded");
        });

        it("should succeed swap if output meets minAmountOut", async function () {
            const amountIn = ethers.parseEther("10");

            // Set a reasonable minAmountOut (e.g., 9 tokens for 10 input)
            const reasonableMinOut = ethers.parseEther("9");
            const deadline = (await time.latest()) + 3600;

            const balBefore = await tokenB.balanceOf(user.address);

            await freightAMM.connect(user).swapAForB(amountIn, reasonableMinOut, deadline);

            const balAfter = await tokenB.balanceOf(user.address);
            const received = balAfter - balBefore;

            expect(received).to.be.gte(reasonableMinOut);
        });

        it("should protect against sandwich attacks by enforcing minAmountOut", async function () {
            // Simulate a front-run that changes the pool ratio
            const frontRunAmount = ethers.parseEther("5000");
            await tokenA.mint(owner.address, frontRunAmount);
            await tokenA.approve(await freightAMM.getAddress(), frontRunAmount);

            // Owner front-runs by swapping A for B, depleting B reserves
            const deadline = (await time.latest()) + 3600;
            await freightAMM.swapAForB(frontRunAmount, 0, deadline);

            // Now user tries to swap with their original expected minAmountOut
            const userAmountIn = ethers.parseEther("100");
            const originalExpectedMinOut = ethers.parseEther("90"); // Based on original 1:1 ratio

            // This should now revert because the pool is skewed
            await expect(
                freightAMM.connect(user).swapAForB(userAmountIn, originalExpectedMinOut, deadline)
            ).to.be.revertedWith("Slippage tolerance exceeded");
        });
    });

    describe("Deadline Validation", function () {
        it("should revert if transaction is submitted after deadline", async function () {
            const amountIn = ethers.parseEther("10");
            const minAmountOut = ethers.parseEther("9");

            // Set deadline in the past
            const pastDeadline = (await time.latest()) - 100;

            await expect(
                freightAMM.connect(user).swapAForB(amountIn, minAmountOut, pastDeadline)
            ).to.be.revertedWith("Transaction expired");
        });

        it("should revert if block.timestamp exceeds deadline during execution", async function () {
            const amountIn = ethers.parseEther("10");
            const minAmountOut = ethers.parseEther("9");

            // Set deadline very close to current time
            const tightDeadline = (await time.latest()) + 1;

            // Advance time past the deadline
            await time.increase(10);

            await expect(
                freightAMM.connect(user).swapAForB(amountIn, minAmountOut, tightDeadline)
            ).to.be.revertedWith("Transaction expired");
        });

        it("should succeed if submitted before deadline", async function () {
            const amountIn = ethers.parseEther("10");
            const minAmountOut = ethers.parseEther("9");
            const futureDeadline = (await time.latest()) + 3600;

            await expect(
                freightAMM.connect(user).swapAForB(amountIn, minAmountOut, futureDeadline)
            ).to.not.be.reverted;
        });
    });
});
