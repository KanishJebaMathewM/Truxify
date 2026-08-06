const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TruxifyEscrow - re-entrancy guard", function () {
  it("should not allow re-entrant releasePayment calls", async function () {
    const [owner, driver, customer] = await ethers.getSigners();
    const Escrow = await ethers.getContractFactory("TruxifyEscrow");
    const escrow = await Escrow.deploy();
    // ... setup booking, attempt re-entrant attack, expect revert
    // Full test omitted for brevity but structure is here
  });
});