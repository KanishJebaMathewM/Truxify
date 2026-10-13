const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

describe("KYCVerifier Security & ZK-SNARK Hardening (#11247)", function () {
  let kycVerifier;
  let mockVerifier;
  let admin, regulator, user1, user2, attacker;
  let validRoot;
  let sampleDocHash;
  let validProof;

  beforeEach(async function () {
    [admin, regulator, user1, user2, attacker] = await ethers.getSigners();

    const MockVerifierFactory = await ethers.getContractFactory("MockKYCVerifier");
    mockVerifier = await MockVerifierFactory.deploy();
    await mockVerifier.waitForDeployment();

    const KYCVerifierFactory = await ethers.getContractFactory("KYCVerifier");
    kycVerifier = await KYCVerifierFactory.deploy();
    await kycVerifier.waitForDeployment();

    // Link custom verifier and set regulator
    await kycVerifier.connect(admin).setCustomVerifier(await mockVerifier.getAddress());
    await kycVerifier.connect(admin).setRegulator(regulator.address);

    validRoot = ethers.keccak256(ethers.toUtf8Bytes("trusted-merkle-root-v1"));
    sampleDocHash = ethers.keccak256(ethers.toUtf8Bytes("document-payload-user1"));

    // Standard non-zero mock proof points
    validProof = {
      a: [1n, 2n],
      b: [[1n, 2n], [3n, 4n]],
      c: [5n, 6n],
    };
  });

  // Scenario 1: Valid authority-approved record passes
  it("1. Valid authority-approved record passes", async function () {
    await kycVerifier.connect(admin).updateTrustedRoot(validRoot);
    expect(await kycVerifier.trustedRoot()).to.equal(validRoot);
    expect(await kycVerifier.isTrustedRoot(validRoot)).to.be.true;

    const input = [
      BigInt(user1.address),
      BigInt(sampleDocHash),
      BigInt(validRoot),
    ];

    const tx = await kycVerifier
      .connect(admin)
      .verifyKYC(validProof.a, validProof.b, validProof.c, input, user1.address);
    const receipt = await tx.wait();

    expect(await kycVerifier.isVerified(user1.address)).to.be.true;
    expect(await kycVerifier.connect(regulator).getDocumentHash(user1.address)).to.equal(sampleDocHash);
    expect(await kycVerifier.getVerificationTime(user1.address)).to.be.greaterThan(0);

    // Verify UserVerified event
    const event = receipt.logs.find(
      (log) => log.fragment && log.fragment.name === "UserVerified"
    );
    expect(event).to.not.be.undefined;
  });

  // Scenario 2: Fabricated record without authority approval fails
  it("2. Fabricated record without authority approval fails", async function () {
    await kycVerifier.connect(admin).updateTrustedRoot(validRoot);
    const untrustedRoot = ethers.keccak256(ethers.toUtf8Bytes("unapproved-root-666"));

    const input = [
      BigInt(user1.address),
      BigInt(sampleDocHash),
      BigInt(untrustedRoot),
    ];

    // Static call should return false
    const success = await kycVerifier
      .connect(admin)
      .verifyKYC.staticCall(validProof.a, validProof.b, validProof.c, input, user1.address);
    expect(success).to.be.false;

    // Transaction should emit VerificationFailed with "Untrusted authority root"
    const tx = await kycVerifier
      .connect(admin)
      .verifyKYC(validProof.a, validProof.b, validProof.c, input, user1.address);
    const receipt = await tx.wait();

    expect(await kycVerifier.isVerified(user1.address)).to.be.false;
    const failedEvent = receipt.logs.find(
      (log) => log.fragment && log.fragment.name === "VerificationFailed"
    );
    expect(failedEvent).to.not.be.undefined;
    expect(failedEvent.args[1]).to.equal("Untrusted authority root");
  });

  // Scenario 3: Forged verified = 1 flag cannot bypass verification
  it("3. Forged verified = 1 flag cannot bypass verification", async function () {
    await kycVerifier.connect(admin).updateTrustedRoot(validRoot);
    // Attacker crafts public input attempting to assert verified = 1 or forge proof
    await mockVerifier.setShouldVerify(false);

    const input = [
      BigInt(user1.address),
      BigInt(sampleDocHash),
      BigInt(validRoot),
    ];

    const success = await kycVerifier
      .connect(admin)
      .verifyKYC.staticCall(validProof.a, validProof.b, validProof.c, input, user1.address);
    expect(success).to.be.false;

    const tx = await kycVerifier
      .connect(admin)
      .verifyKYC(validProof.a, validProof.b, validProof.c, input, user1.address);
    const receipt = await tx.wait();

    expect(await kycVerifier.isVerified(user1.address)).to.be.false;
    const failedEvent = receipt.logs.find(
      (log) => log.fragment && log.fragment.name === "VerificationFailed"
    );
    expect(failedEvent).to.not.be.undefined;
    expect(failedEvent.args[1]).to.equal("Invalid ZK proof");
  });

  // Scenario 4: Mismatched document hash fails
  it("4. Mismatched document hash fails", async function () {
    await kycVerifier.connect(admin).updateTrustedRoot(validRoot);

    // Regulator pre-registers official document hash for user1
    await kycVerifier.connect(regulator).hashDocument(sampleDocHash, user1.address);

    const mismatchedDocHash = ethers.keccak256(ethers.toUtf8Bytes("tampered-doc-data"));
    const input = [
      BigInt(user1.address),
      BigInt(mismatchedDocHash),
      BigInt(validRoot),
    ];

    const success = await kycVerifier
      .connect(admin)
      .verifyKYC.staticCall(validProof.a, validProof.b, validProof.c, input, user1.address);
    expect(success).to.be.false;

    const tx = await kycVerifier
      .connect(admin)
      .verifyKYC(validProof.a, validProof.b, validProof.c, input, user1.address);
    const receipt = await tx.wait();

    expect(await kycVerifier.isVerified(user1.address)).to.be.false;
    const failedEvent = receipt.logs.find(
      (log) => log.fragment && log.fragment.name === "VerificationFailed"
    );
    expect(failedEvent).to.not.be.undefined;
    expect(failedEvent.args[1]).to.equal("Mismatched document hash");
  });

  // Scenario 5: Invalid Merkle proof fails
  it("5. Invalid Merkle proof fails", async function () {
    await kycVerifier.connect(admin).updateTrustedRoot(validRoot);

    // Verifier checks expected input matching valid Merkle path
    const validInputs = [
      BigInt(user1.address),
      BigInt(sampleDocHash),
      BigInt(validRoot),
    ];
    await mockVerifier.setExpectedInput(validInputs);

    // Attacker sends inputs with bad Merkle leaf / commitment
    const badInputs = [
      BigInt(user1.address),
      BigInt(sampleDocHash),
      BigInt(validRoot),
      99999n, // unexpected extra / invalid signal
    ];

    const success = await kycVerifier
      .connect(admin)
      .verifyKYC.staticCall(validProof.a, validProof.b, validProof.c, badInputs, user1.address);
    expect(success).to.be.false;

    expect(await kycVerifier.isVerified(user1.address)).to.be.false;
  });

  // Scenario 6: Proof for one driver cannot verify another driver
  it("6. Proof for one driver cannot verify another driver", async function () {
    await kycVerifier.connect(admin).updateTrustedRoot(validRoot);

    // Proof bound to user1.address
    const inputForUser1 = [
      BigInt(user1.address),
      BigInt(sampleDocHash),
      BigInt(validRoot),
    ];

    // Attacker attempts to verify user2 using user1's proof
    const success = await kycVerifier
      .connect(admin)
      .verifyKYC.staticCall(validProof.a, validProof.b, validProof.c, inputForUser1, user2.address);
    expect(success).to.be.false;

    const tx = await kycVerifier
      .connect(admin)
      .verifyKYC(validProof.a, validProof.b, validProof.c, inputForUser1, user2.address);
    const receipt = await tx.wait();

    expect(await kycVerifier.isVerified(user2.address)).to.be.false;
    const failedEvent = receipt.logs.find(
      (log) => log.fragment && log.fragment.name === "VerificationFailed"
    );
    expect(failedEvent).to.not.be.undefined;
    expect(failedEvent.args[1]).to.equal("Proof not bound to user");
  });

  // Scenario 7: Modified public inputs and replay attempts rejected
  it("7. Modified public inputs and replay attempts rejected", async function () {
    await kycVerifier.connect(admin).updateTrustedRoot(validRoot);

    const input = [
      BigInt(user1.address),
      BigInt(sampleDocHash),
      BigInt(validRoot),
    ];

    // 1st attempt: Successful verification
    const firstTx = await kycVerifier
      .connect(admin)
      .verifyKYC(validProof.a, validProof.b, validProof.c, input, user1.address);
    await firstTx.wait();
    expect(await kycVerifier.isVerified(user1.address)).to.be.true;

    // 2nd attempt: Replay attempt with identical proof and inputs
    const replaySuccess = await kycVerifier
      .connect(admin)
      .verifyKYC.staticCall(validProof.a, validProof.b, validProof.c, input, user1.address);
    expect(replaySuccess).to.be.false;

    const replayTx = await kycVerifier
      .connect(admin)
      .verifyKYC(validProof.a, validProof.b, validProof.c, input, user1.address);
    const replayReceipt = await replayTx.wait();

    const failedEvent = replayReceipt.logs.find(
      (log) => log.fragment && log.fragment.name === "VerificationFailed"
    );
    expect(failedEvent).to.not.be.undefined;
    expect(failedEvent.args[1]).to.equal("User already verified");
  });

  // Scenario 8: Invalid field encodings/malformed inputs fail
  it("8. Invalid field encodings/malformed inputs fail", async function () {
    await kycVerifier.connect(admin).updateTrustedRoot(validRoot);

    // 8a: All-zero proof is rejected
    await expect(
      kycVerifier.connect(admin).verifyKYC(
        [0n, 0n],
        [[0n, 0n], [0n, 0n]],
        [0n, 0n],
        [BigInt(user1.address), BigInt(sampleDocHash), BigInt(validRoot)],
        user1.address
      )
    ).to.be.revertedWith("Zero proof rejected");

    // 8b: Zero address user rejected
    await expect(
      kycVerifier.connect(admin).verifyKYC(
        validProof.a,
        validProof.b,
        validProof.c,
        [0n, BigInt(sampleDocHash), BigInt(validRoot)],
        ethers.ZeroAddress
      )
    ).to.be.revertedWith("KYCVerifier: Invalid user address");

    // 8c: Short input array (length < 2) rejected
    await expect(
      kycVerifier.connect(admin).verifyKYC(
        validProof.a,
        validProof.b,
        validProof.c,
        [BigInt(user1.address)],
        user1.address
      )
    ).to.be.revertedWith("Invalid public input length");

    // 8d: Zero document hash fails
    const zeroDocInput = [
      BigInt(user1.address),
      0n,
      BigInt(validRoot),
    ];
    const zeroDocSuccess = await kycVerifier
      .connect(admin)
      .verifyKYC.staticCall(validProof.a, validProof.b, validProof.c, zeroDocInput, user1.address);
    expect(zeroDocSuccess).to.be.false;
  });

  // Scenario 9: Existing valid flows continue to work
  it("9. Existing valid flows continue to work", async function () {
    // 9a: Non-admin cannot call verifyKYC
    const input = [
      BigInt(user1.address),
      BigInt(sampleDocHash),
      BigInt(validRoot),
    ];
    await expect(
      kycVerifier.connect(attacker).verifyKYC(validProof.a, validProof.b, validProof.c, input, user1.address)
    ).to.be.revertedWith("Only admin can call this");

    // 9b: Non-authority cannot update trusted root
    await expect(
      kycVerifier.connect(attacker).updateTrustedRoot(validRoot)
    ).to.be.revertedWith("KYCVerifier: Only authority can call this");

    // 9c: Regulator can revoke verification
    await kycVerifier.connect(admin).updateTrustedRoot(validRoot);
    await kycVerifier.connect(admin).verifyKYC(validProof.a, validProof.b, validProof.c, input, user1.address);
    expect(await kycVerifier.isVerified(user1.address)).to.be.true;

    await kycVerifier.connect(regulator).revokeVerification(user1.address);
    expect(await kycVerifier.isVerified(user1.address)).to.be.false;
  });
});
