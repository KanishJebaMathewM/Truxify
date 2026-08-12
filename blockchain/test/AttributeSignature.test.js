const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AttributeSignature ABS Verification", function () {
  it("Should verify valid attribute-based signatures for dynamic policy predicates", async function () {
    const [owner] = await ethers.getSigners();
    const AttributeSignature = await ethers.getContractFactory("AttributeSignature");
    const absContract = await AttributeSignature.deploy();

    const manifestHash = ethers.keccak256(ethers.toUtf8Bytes("HAZMAT_PERMIT_001"));
    const policy = "Driver.hazmat == true AND Driver.experience >= 3";
    
    // 64-byte mock signature carrying non-zero values for pairing simulation
    const mockSignature = ethers.concat([
      ethers.toBeHex(1, 32),
      ethers.toBeHex(2, 32)
    ]);

    const tx = await absContract.verifyAttributeSignature(manifestHash, policy, mockSignature);
    await tx.wait();

    // Verify simulation output
    expect(await absContract.verifyAttributeSignature.staticCall(manifestHash, policy, mockSignature)).to.equal(true);
  });
});
