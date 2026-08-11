const assert = require("node:assert/strict");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

async function assertRejectsWith(promise, message) {
  await assert.rejects(promise, (error) => error.message.includes(message));
}

function commitHashFor(secret, address) {
  return ethers.keccak256(ethers.solidityPacked(["bytes32", "address"], [secret, address]));
}

describe("MEVProtectedEscrow reveal verification", function () {
  async function deployEscrow() {
    const [owner, customer, driver, outsider] = await ethers.getSigners();
    const Escrow = await ethers.getContractFactory("MEVProtectedEscrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();
    return { escrow, owner, customer, driver, outsider };
  }

  it("binds the revealed secret back into the escrow's stored secret field", async function () {
    const { escrow, customer, driver } = await deployEscrow();
    const secret = ethers.id("mev-secret-bind");
    const secretHash = commitHashFor(secret, customer.address);
    const amount = ethers.parseEther("1");

    await escrow.connect(customer).createCommitment(secretHash);
    await escrow.connect(customer).createEscrow(driver.address, secretHash, { value: amount });
    await escrow.connect(customer).revealCommitment(secret, 1);

    const saved = await escrow.escrows(1);
    assert.equal(saved.revealed, true);
    assert.equal(saved.secret, secret);
  });

  it("rejects reveal of an escrow by an address that is not the committer", async function () {
    const { escrow, customer, driver, outsider } = await deployEscrow();
    const secret = ethers.id("mev-secret-outsider");
    const secretHash = commitHashFor(secret, customer.address);
    const amount = ethers.parseEther("1");

    await escrow.connect(customer).createCommitment(secretHash);
    await escrow.connect(customer).createEscrow(driver.address, secretHash, { value: amount });

    // Outsider tries to reveal with the same secret — the hash binds the
    // secret to the customer's address, so the outsider's commitment is 0.
    await assertRejectsWith(
      escrow.connect(outsider).revealCommitment(secret, 1),
      "Invalid commit"
    );
    const saved = await escrow.escrows(1);
    assert.equal(saved.revealed, false);
  });

  it("rejects reveal where the caller's commitment does not match the escrow", async function () {
    const { escrow, customer, driver } = await deployEscrow();
    const secretA = ethers.id("mev-secret-a");
    const secretB = ethers.id("mev-secret-b");
    const secretHashA = commitHashFor(secretA, customer.address);
    const secretHashB = commitHashFor(secretB, customer.address);
    const amount = ethers.parseEther("1");

    // Customer commits to A and locks the escrow under A's hash.
    await escrow.connect(customer).createCommitment(secretHashA);
    await escrow.connect(customer).createEscrow(driver.address, secretHashA, { value: amount });

    // Customer re-commits to B (the commitment slot is overwritten) and then
    // tries to reveal B against the escrow locked under A. B is a valid
    // commitment, but it does not match the escrow's commitHash — the secret
    // cannot be re-bound to an escrow it was never committed for.
    await escrow.connect(customer).createCommitment(secretHashB);
    await assertRejectsWith(
      escrow.connect(customer).revealCommitment(secretB, 1),
      "Commit does not match escrow"
    );
    const saved = await escrow.escrows(1);
    assert.equal(saved.revealed, false);
    assert.equal(saved.secret, ethers.ZeroHash);
  });

  it("rejects reveal once the reveal deadline has passed", async function () {
    const { escrow, owner, customer, driver } = await deployEscrow();
    const secret = ethers.id("mev-secret-late");
    const secretHash = commitHashFor(secret, customer.address);
    const amount = ethers.parseEther("1");

    await escrow.connect(customer).createCommitment(secretHash);
    await escrow.connect(customer).createEscrow(driver.address, secretHash, { value: amount });

    // The report's concern is reveal "at any future block". The reveal must
    // stay bounded to the commit-reveal window: advancing well past the
    // deadline must reject the reveal.
    const commitRevealPeriod = Number(await escrow.commitRevealPeriod());
    for (let i = 0; i < commitRevealPeriod + 5; i++) {
      await ethers.provider.send("evm_mine", []);
    }
    await assertRejectsWith(
      escrow.connect(customer).revealCommitment(secret, 1),
      "Reveal deadline passed"
    );
    const saved = await escrow.escrows(1);
    assert.equal(saved.revealed, false);
  });

  it("prevents re-binding a different secret to an already-revealed escrow", async function () {
    const { escrow, customer, driver } = await deployEscrow();
    const secret = ethers.id("mev-secret-double");
    const otherSecret = ethers.id("mev-secret-double-2");
    const secretHash = commitHashFor(secret, customer.address);
    const amount = ethers.parseEther("1");

    await escrow.connect(customer).createCommitment(secretHash);
    await escrow.connect(customer).createEscrow(driver.address, secretHash, { value: amount });
    await escrow.connect(customer).revealCommitment(secret, 1);

    // A second reveal with a different secret must be rejected even though
    // the caller still holds a (different) valid commitment.
    await assertRejectsWith(
      escrow.connect(customer).revealCommitment(otherSecret, 1),
      "Invalid commit"
    );
    const saved = await escrow.escrows(1);
    assert.equal(saved.revealed, true);
    assert.equal(saved.secret, secret);
  });
});
