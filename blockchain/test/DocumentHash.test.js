// blockchain/test/DocumentHash.test.js
// Tests for document hash integrity verification

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DocumentHash Contract", function () {
  let docHash;
  let owner;
  let driver;

  // Sample document hash (SHA-256 of a fake RC book)
  const SAMPLE_HASH = ethers.keccak256(ethers.toUtf8Bytes("RC_BOOK_NUMBER_MH01AB1234"));
  const SAMPLE_HASH_2 = ethers.keccak256(ethers.toUtf8Bytes("LICENCE_NUMBER_DL12345"));

  beforeEach(async function () {
    [owner, driver] = await ethers.getSigners();

    // ⚠️ Replace "DocumentHash" with your actual contract name
    const DocHashFactory = await ethers.getContractFactory("DocumentHash");
    docHash = await DocHashFactory.deploy();
    await docHash.waitForDeployment();
  });

  it("Should store a document hash for a driver", async function () {
    // ⚠️ Replace "storeHash" with your actual function name
    await docHash.connect(owner).storeHash(driver.address, SAMPLE_HASH);

    // ⚠️ Replace "getHash" with your actual function name
    const stored = await docHash.getHash(driver.address);
    expect(stored).to.equal(SAMPLE_HASH);
  });

  it("Should return false for a hash that was not stored", async function () {
    // ⚠️ Replace "verifyHash" with your actual function name
    const isValid = await docHash.verifyHash(driver.address, SAMPLE_HASH_2);
    expect(isValid).to.equal(false);
  });

  it("Should return true when correct hash is verified", async function () {
    await docHash.connect(owner).storeHash(driver.address, SAMPLE_HASH);
    const isValid = await docHash.verifyHash(driver.address, SAMPLE_HASH);
    expect(isValid).to.equal(true);
  });

  it("Unauthorized address cannot store a hash", async function () {
    await expect(
      docHash.connect(driver).storeHash(driver.address, SAMPLE_HASH)
    ).to.be.reverted;
  });
});