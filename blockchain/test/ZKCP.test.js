const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ZKCP Route Data Swaps", function () {
  it("Should lock payment and release atomically upon key validation", async function () {
    const [buyer, seller] = await ethers.getSigners();
    const ZKCP = await ethers.getContractFactory("ZKCP");
    const zkcp = await ZKCP.deploy();

    const agreementId = ethers.keccak256(ethers.toUtf8Bytes("AGREEMENT_101"));
    const key = ethers.keccak256(ethers.toUtf8Bytes("DECRYPTION_SECRET_KEY_456"));
    
    // Hash commitment corresponding to SHA256 of the secret key
    const rawBytes = ethers.toBeHex(key);
    const dataHash = ethers.sha256(rawBytes);

    // Lock 1 ETH payment
    await zkcp.connect(buyer).lockPayment(
      agreementId,
      seller.address,
      dataHash,
      3600, // 1 hour timelock
      { value: ethers.parseEther("1.0") }
    );

    // Claim payment using secret decryption key
    await zkcp.connect(seller).claimPayment(agreementId, key);

    const agreement = await zkcp.agreements(agreementId);
    expect(agreement.completed).to.equal(true);
  });
});
