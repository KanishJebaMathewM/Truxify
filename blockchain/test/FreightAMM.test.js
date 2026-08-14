const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FreightAMM swap pools", function () {
  it("Should swap tokens using constant product formula", async function () {
    const [owner, provider, swapper] = await ethers.getSigners();
    
    // Deploy Governance/Credit Token and Stablecoin Token
    const DAOToken = await ethers.getContractFactory("DAOToken");
    const tokenX = await DAOToken.deploy(); // X Credit
    const tokenY = await DAOToken.deploy(); // Y Stable

    const FreightAMM = await ethers.getContractFactory("FreightAMM");
    const amm = await FreightAMM.deploy(await tokenX.getAddress(), await tokenY.getAddress());

    // Mint/transfer tokens to provider and AMM
    await tokenX.approve(await amm.getAddress(), 1000);
    await tokenY.approve(await amm.getAddress(), 1000);
    await amm.addLiquidity(1000, 1000); // 1:1 pool ratio

    await tokenX.transfer(swapper.address, 100);
    await tokenX.connect(swapper).approve(await amm.getAddress(), 100);

    // Swap 100 Credit tokens to Stablecoin
    // Expected output Stable = (1000 * 100) / (1000 + 100) = 90.9 => 90 Stable
    await amm.connect(swapper).swap(100, true, 0);

    expect(await tokenY.balanceOf(swapper.address)).to.equal(90);
  });

  it("Should revert when output falls below minAmountOut", async function () {
    const [owner, provider, swapper] = await ethers.getSigners();

    const DAOToken = await ethers.getContractFactory("DAOToken");
    const tokenX = await DAOToken.deploy();
    const tokenY = await DAOToken.deploy();

    const FreightAMM = await ethers.getContractFactory("FreightAMM");
    const amm = await FreightAMM.deploy(await tokenX.getAddress(), await tokenY.getAddress());

    await tokenX.approve(await amm.getAddress(), 1000);
    await tokenY.approve(await amm.getAddress(), 1000);
    await amm.addLiquidity(1000, 1000);

    await tokenX.transfer(swapper.address, 100);
    await tokenX.connect(swapper).approve(await amm.getAddress(), 100);

    // 100 Credit in against 1000/1000 pool yields only 90 Stable out
    await expect(amm.connect(swapper).swap(100, true, 91)).to.be.revertedWith("Swap output below minAmountOut");
  });

  it("Should retain the swap fee in the pool reserve", async function () {
    const [owner, provider, swapper] = await ethers.getSigners();

    const DAOToken = await ethers.getContractFactory("DAOToken");
    const tokenX = await DAOToken.deploy();
    const tokenY = await DAOToken.deploy();

    const FreightAMM = await ethers.getContractFactory("FreightAMM");
    const amm = await FreightAMM.deploy(await tokenX.getAddress(), await tokenY.getAddress());

    await tokenX.approve(await amm.getAddress(), 1000);
    await tokenY.approve(await amm.getAddress(), 1000);
    await amm.addLiquidity(1000, 1000);

    await tokenX.transfer(swapper.address, 1000);
    await tokenX.connect(swapper).approve(await amm.getAddress(), 1000);

    // 0.3% fee on 1000 Credit input = 3 Credit, kept in the pool
    await amm.connect(swapper).swap(1000, true, 0);

    expect(await amm.reserveCredit()).to.equal(2000);
    expect(await tokenX.balanceOf(amm.getAddress())).to.equal(2000);
  });
});
