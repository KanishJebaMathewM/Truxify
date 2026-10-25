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

    // Commit a data root, then submit a proof whose leaf does not hash to it.
    const root = ethers.keccak256(ethers.toUtf8Bytes("DATA_ROOT_BLOCK_101"));
    await por.connect(provider).commitDataRoot(root);

    // A bogus leaf (with an empty proof path, the computed root is the leaf
    // itself) fails the on-chain check -> automated slashing.
    const mockLeaf = ethers.keccak256(ethers.toUtf8Bytes("MOCK_MERKLE_LEAF_BLOCK_101"));

    // The deployer is the default verifier (see constructor).
    await por.verifyStorageProof(provider.address, 101, mockLeaf, []);

    status = await por.providers(provider.address);
    expect(status.active).to.equal(false);
    expect(status.lockedCollateral).to.equal(0);
  });

  it("Should keep the provider active when the proof matches the committed data root", async function () {
    const [owner, provider] = await ethers.getSigners();
    const StoragePoR = await ethers.getContractFactory("StoragePoR");
    const por = await StoragePoR.deploy();

    const collateral = ethers.parseEther("1.0");
    await por.connect(provider).registerProvider(collateral, { value: collateral });

    const root = ethers.keccak256(ethers.toUtf8Bytes("DATA_ROOT_BLOCK_101"));
    await por.connect(provider).commitDataRoot(root);

    const blockIndex = 101;
    // With an empty proof path the computed root is the leaf itself, so the
    // leaf equal to the committed root verifies.
    const validLeaf = root;

    await por.verifyStorageProof(provider.address, blockIndex, validLeaf, []);

    const status = await por.providers(provider.address);
    expect(status.active).to.equal(true);
    expect(status.lastVerifiedBlock).to.be.greaterThan(0);
    expect(status.lockedCollateral).to.equal(collateral);
  });
});
