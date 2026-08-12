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
    await amm.connect(swapper).swap(100, true);

    expect(await tokenY.balanceOf(swapper.address)).to.equal(90);
  });
});
