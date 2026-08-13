const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("StoragePoR Contract", function () {
  it("Should slash provider collateral if proof verification checks fail", async function () {
    const [owner, provider] = await ethers.getSigners();
    const StoragePoR = await ethers.getContractFactory("StoragePoR");
    const por = await StoragePoR.deploy();

    const collateral = ethers.parseEther("1.0");

    // Register provider with collateral
    await por.connect(provider).registerProvider(collateral, { value: collateral });
    
    let status = await por.providers(provider.address);
    expect(status.active).to.equal(true);

    const mockMerkle = ethers.keccak256(ethers.toUtf8Bytes("MOCK_MERKLE_LEAF_BLOCK_101"));

    // Verify invalid proof -> triggers automated slashing
    await por.verifyStorageProof(provider.address, 101, mockMerkle, false);

    status = await por.providers(provider.address);
    expect(status.active).to.equal(false);
    expect(status.lockedCollateral).to.equal(0);
  });
});
