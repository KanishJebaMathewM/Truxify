const { expect } = require("chai");
const { ethers } = require("hardhat");

function deriveNullifier(tripId, rater) {
  return ethers.keccak256(
    ethers.solidityPacked(["bytes32", "address"], [tripId, rater])
  );
}

function proofWithInput(input) {
  return {
    a: [1n, 2n],
    b: [
      [3n, 4n],
      [5n, 6n],
    ],
    c: [7n, 8n],
    input,
  };
}

async function expectRevert(promise, expectedMessage) {
  try {
    await promise;
    expect.fail("Expected transaction to revert");
  } catch (error) {
    const reason =
      error.reason ??
      error.info?.error?.message ??
      error.shortMessage ??
      error.message ??
      "";
    if (!reason.toLowerCase().includes(expectedMessage.toLowerCase())) {
      const fullMsg = JSON.stringify(error).toLowerCase();
      if (!fullMsg.includes(expectedMessage.toLowerCase())) {
        expect.fail(
          `Expected revert reason to include "${expectedMessage}", got: "${reason}"`
        );
      }
    }
  }
}

describe("ZKPrivacy submitAnonymousRating", function () {
  let zkPrivacy, verifier;
  let driver, rater, otherRater;
  const tripId = ethers.id("trip-0001");

  beforeEach(async function () {
    [driver, rater, otherRater] = await ethers.getSigners();

    const MockVerifier = await ethers.getContractFactory(
      "MockZKPrivacyVerifier"
    );
    verifier = await MockVerifier.deploy();
    await verifier.waitForDeployment();

    const ZKPrivacy = await ethers.getContractFactory("ZKPrivacy");
    zkPrivacy = await ZKPrivacy.deploy(await verifier.getAddress());
    await zkPrivacy.waitForDeployment();
  });

  it("accepts a rating whose proof verifies and binds nullifier, driver and stars", async function () {
    const nullifier = deriveNullifier(tripId, rater.address);
    const input = [
      BigInt(nullifier),
      BigInt(driver.address),
      5n,
    ];
    await verifier.setShouldVerify(true);
    await verifier.setExpectedInput(input);

    await zkPrivacy
      .connect(rater)
      .submitAnonymousRating(driver.address, 5, tripId, proofWithInput(input));

    expect(await zkPrivacy.usedNullifiers(nullifier)).to.equal(true);
    expect(await zkPrivacy.getDriverAverageRating(driver.address)).to.equal(500n);
  });

  it("derives a distinct nullifier per rater for the same trip", async function () {
    const raterNullifier = deriveNullifier(tripId, rater.address);
    const otherNullifier = deriveNullifier(tripId, otherRater.address);
    expect(raterNullifier).to.not.equal(otherNullifier);

    for (const [who, nullifier] of [
      [rater, raterNullifier],
      [otherRater, otherNullifier],
    ]) {
      const input = [BigInt(nullifier), BigInt(driver.address), 4n];
      await verifier.setShouldVerify(true);
      await verifier.setExpectedInput(input);
      await zkPrivacy
        .connect(who)
        .submitAnonymousRating(driver.address, 4, tripId, proofWithInput(input));
    }

    expect(await zkPrivacy.getDriverAverageRating(driver.address)).to.equal(400n);
  });

  it("rejects a forged proof that fails verification", async function () {
    const nullifier = deriveNullifier(tripId, rater.address);
    const input = [BigInt(nullifier), BigInt(driver.address), 5n];
    await verifier.setShouldVerify(false);
    await verifier.setExpectedInput(input);

    await expectRevert(
      zkPrivacy
        .connect(rater)
        .submitAnonymousRating(driver.address, 5, tripId, proofWithInput(input)),
      "Invalid ZK proof"
    );

    expect(await zkPrivacy.getDriverAverageRating(driver.address)).to.equal(0n);
    expect(await zkPrivacy.usedNullifiers(nullifier)).to.equal(false);
  });

  it("rejects a proof whose public inputs do not match the rating parameters", async function () {
    const nullifier = deriveNullifier(tripId, rater.address);
    const correctInput = [BigInt(nullifier), BigInt(driver.address), 5n];

    // The verifier would accept this input, but it does not commit to the
    // derived nullifier, so the contract must fail closed.
    const mismatchedInput = [BigInt(ethers.id("attacker-nullifier")), BigInt(driver.address), 5n];
    await verifier.setShouldVerify(true);
    await verifier.setExpectedInput(mismatchedInput);

    await expectRevert(
      zkPrivacy
        .connect(rater)
        .submitAnonymousRating(driver.address, 5, tripId, proofWithInput(mismatchedInput)),
      "Nullifier mismatch in proof input"
    );
  });

  it("rejects a proof with missing public inputs", async function () {
    const nullifier = deriveNullifier(tripId, rater.address);
    const input = [BigInt(nullifier), BigInt(driver.address), 5n];
    await verifier.setShouldVerify(true);
    await verifier.setExpectedInput(input);

    await expectRevert(
      zkPrivacy
        .connect(rater)
        .submitAnonymousRating(driver.address, 5, tripId, proofWithInput([])),
      "Invalid proof public inputs length"
    );
  });

  it("rejects a duplicate nullifier for the same trip and rater", async function () {
    const nullifier = deriveNullifier(tripId, rater.address);
    const input = [BigInt(nullifier), BigInt(driver.address), 5n];
    await verifier.setShouldVerify(true);
    await verifier.setExpectedInput(input);

    await zkPrivacy
      .connect(rater)
      .submitAnonymousRating(driver.address, 5, tripId, proofWithInput(input));

    await expectRevert(
      zkPrivacy
        .connect(rater)
        .submitAnonymousRating(driver.address, 5, tripId, proofWithInput(input)),
      "Nullifier already used for trip rating"
    );
  });

  it("rejects ratings outside the valid star range", async function () {
    const nullifier = deriveNullifier(tripId, rater.address);
    const input = [BigInt(nullifier), BigInt(driver.address), 0n];
    await verifier.setShouldVerify(true);
    await verifier.setExpectedInput(input);

    await expectRevert(
      zkPrivacy
        .connect(rater)
        .submitAnonymousRating(driver.address, 0, tripId, proofWithInput(input)),
      "Invalid rating stars (1-5)"
    );
  });
});
