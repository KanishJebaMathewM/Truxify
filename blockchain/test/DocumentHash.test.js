// blockchain/test/DocumentHash.test.js
// Tests for document hash integrity verification (DocumentRegistry contract)

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DocumentRegistry Contract", function () {
  let registry;
  let owner;
  let driver;

  // Sample document hash (SHA-256 of a fake RC book)
  const SAMPLE_HASH = ethers.keccak256(ethers.toUtf8Bytes("RC_BOOK_NUMBER_MH01AB1234"));
  const SAMPLE_HASH_2 = ethers.keccak256(ethers.toUtf8Bytes("LICENCE_NUMBER_DL12345"));
  const DOC_TYPE = "RC_BOOK";

  beforeEach(async function () {
    [owner, driver] = await ethers.getSigners();

    const DocRegistryFactory = await ethers.getContractFactory("DocumentRegistry");
    registry = await DocRegistryFactory.deploy();
    await registry.waitForDeployment();
  });

  it("Should store a document hash for a driver", async function () {
    await registry.connect(owner).registerDocument(driver.address, DOC_TYPE, SAMPLE_HASH, true);

    const [storedHash, docType, , isVerified] = await registry.getDocument(driver.address, DOC_TYPE);
    expect(storedHash).to.equal(SAMPLE_HASH);
    expect(docType).to.equal(DOC_TYPE);
    expect(isVerified).to.equal(true);
  });

  it("Should return an empty record for a hash that was not stored", async function () {
    const [storedHash, , registeredAt] = await registry.getDocument(driver.address, "LICENCE");
    expect(storedHash).to.equal(ethers.ZeroHash);
    expect(registeredAt).to.equal(0);
  });

  it("Should return the stored hash when it is queried", async function () {
    await registry.connect(owner).registerDocument(driver.address, DOC_TYPE, SAMPLE_HASH, true);
    const [storedHash] = await registry.getDocument(driver.address, DOC_TYPE);
    expect(storedHash).to.equal(SAMPLE_HASH);

    // A different document type must not alias the stored hash.
    const [otherHash] = await registry.getDocument(driver.address, "LICENCE");
    expect(otherHash).to.not.equal(SAMPLE_HASH_2);
    expect(otherHash).to.equal(ethers.ZeroHash);
  });

  it("Unauthorized address cannot register a document", async function () {
    await expect(
      registry.connect(driver).registerDocument(driver.address, DOC_TYPE, SAMPLE_HASH, true)
    ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
  });

  it("Rejects a zero document hash (fail-closed)", async function () {
    await expect(
      registry.connect(owner).registerDocument(driver.address, DOC_TYPE, ethers.ZeroHash, true)
    ).to.be.revertedWith("DocumentRegistry: Invalid zero hash");
  });
});
