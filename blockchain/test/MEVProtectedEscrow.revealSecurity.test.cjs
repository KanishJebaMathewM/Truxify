const assert = require("node:assert/strict");
const { ethers } = require("hardhat");
<<<<<<< HEAD
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
=======
const { expect } = require("chai");

/**
 * Reveal/security tests for MEVProtectedEscrow against the real contract
 * surface (createProtectedDeposit / releaseDepositPrivate / refundDeposit),
 * replacing the stale tests that referenced non-existent methods
 * (createCommitment / createEscrow / revealCommitment / escrows).
 *
 * releaseDepositPrivate verifies `keccak256(abi.encodePacked(_preimage))`
 * against the deposit's secretHash, so the committed hash is the keccak of the
 * exact 32-byte preimage that gets revealed.
 */
function preimageFor(secret) {
  return ethers.keccak256(ethers.toUtf8Bytes(secret));
}

function secretHashFor(preimage) {
  return ethers.keccak256(preimage);
}

describe("MEVProtectedEscrow reveal security", function () {
  async function deployEscrow() {
    const [owner, customer, driver, outsider, relayer] = await ethers.getSigners();
    const Escrow = await ethers.getContractFactory("MEVProtectedEscrow");
    const escrow = await Escrow.deploy(relayer.address);
    await escrow.waitForDeployment();
    return { escrow, owner, customer, driver, outsider, relayer };
  }

  async function createDeposit(escrow, customer, driver, preimage, amount) {
    const tx = await escrow.connect(customer).createProtectedDeposit(
      driver.address,
      secretHashFor(preimage),
      { value: amount }
    );
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log) => {
        try {
          return escrow.interface.parseLog(log);
        } catch (e) {
          return null;
        }
      })
      .find((p) => p && p.name === "DepositCreated");
    return Number(event.args.depositId);
  }

  it("releases funds to the driver when the trusted relayer reveals the correct preimage", async function () {
    const { escrow, customer, driver, relayer } = await deployEscrow();
    const preimage = preimageFor("mev-secret-correct");
    const amount = ethers.parseEther("1");

    const depositId = await createDeposit(escrow, customer, driver, preimage, amount);

    const before = await ethers.provider.getBalance(driver.address);
    await expect(escrow.connect(relayer).releaseDepositPrivate(depositId, preimage))
      .to.emit(escrow, "DepositReleasedMEV")
      .withArgs(depositId, driver.address, amount);
    const after = await ethers.provider.getBalance(driver.address);

    assert.equal(after - before, amount);

    const saved = await escrow.deposits(depositId);
    assert.equal(saved.released, true);
    assert.equal(saved.secretHash, secretHashFor(preimage));
  });

  it("rejects release with a wrong preimage and keeps the deposit unreleased", async function () {
    const { escrow, customer, driver, relayer } = await deployEscrow();
    const preimage = preimageFor("mev-secret-right");
    const wrongPreimage = preimageFor("mev-secret-wrong");
    const amount = ethers.parseEther("1");

    const depositId = await createDeposit(escrow, customer, driver, preimage, amount);

    await expect(
      escrow.connect(relayer).releaseDepositPrivate(depositId, wrongPreimage)
    ).to.be.revertedWith("Invalid preimage");

    const saved = await escrow.deposits(depositId);
    assert.equal(saved.released, false);
  });

  it("rejects release by an address that is not the trusted relayer or owner", async function () {
    const { escrow, customer, driver, outsider } = await deployEscrow();
    const preimage = preimageFor("mev-secret-outsider");
    const amount = ethers.parseEther("1");

    const depositId = await createDeposit(escrow, customer, driver, preimage, amount);

    await expect(
      escrow.connect(outsider).releaseDepositPrivate(depositId, preimage)
    ).to.be.revertedWith("Caller is not trusted MEV relayer");

    const saved = await escrow.deposits(depositId);
    assert.equal(saved.released, false);
  });

  it("rejects releasing an already-released deposit", async function () {
    const { escrow, customer, driver, relayer } = await deployEscrow();
    const preimage = preimageFor("mev-secret-double");
    const amount = ethers.parseEther("1");

    const depositId = await createDeposit(escrow, customer, driver, preimage, amount);

    await escrow.connect(relayer).releaseDepositPrivate(depositId, preimage);
    await expect(
      escrow.connect(relayer).releaseDepositPrivate(depositId, preimage)
    ).to.be.revertedWith("Already released");
  });

  it("lets the owner rotate the trusted relayer, revoking the old relayer", async function () {
    const { escrow, owner, customer, driver, relayer } = await deployEscrow();
    const [, , , , , newRelayer] = await ethers.getSigners();
    const preimage = preimageFor("mev-secret-rotate");
    const amount = ethers.parseEther("1");

    assert.notEqual(newRelayer.address, relayer.address);
    await expect(escrow.connect(owner).updateRelayer(newRelayer.address))
      .to.emit(escrow, "RelayerUpdated")
      .withArgs(newRelayer.address);
    assert.equal(await escrow.trustedRelayer(), newRelayer.address);

    const depositId = await createDeposit(escrow, customer, driver, preimage, amount);

    await expect(
      escrow.connect(relayer).releaseDepositPrivate(depositId, preimage)
    ).to.be.revertedWith("Caller is not trusted MEV relayer");
    await escrow.connect(newRelayer).releaseDepositPrivate(depositId, preimage);
    const saved = await escrow.deposits(depositId);
    assert.equal(saved.released, true);
  });

  it("does not allow a non-owner to rotate the trusted relayer", async function () {
    const { escrow, customer } = await deployEscrow();
    const [, , , , , other] = await ethers.getSigners();
    await expect(
      escrow.connect(customer).updateRelayer(other.address)
    ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
  });

  it("refunds the shipper after the MEV-protection window closes", async function () {
    const { escrow, customer, driver } = await deployEscrow();
    const preimage = preimageFor("mev-secret-refund");
    const amount = ethers.parseEther("1");

    const depositId = await createDeposit(escrow, customer, driver, preimage, amount);

    // Before REFUND_WINDOW the refund must be rejected.
    await expect(escrow.refundDeposit(depositId)).to.be.revertedWith("Refund window not open");

    // Mine past the 5760-block refund window.
    await ethers.provider.send("hardhat_mine", ["0x1690", "0x1"]);

    const before = await ethers.provider.getBalance(customer.address);
    await expect(escrow.refundDeposit(depositId))
      .to.emit(escrow, "DepositRefunded")
      .withArgs(depositId, customer.address, amount);
    const after = await ethers.provider.getBalance(customer.address);

    assert.equal(after - before, amount);
    const saved = await escrow.deposits(depositId);
    assert.equal(saved.released, true);
  });

  it("does not allow refunding an already-released deposit", async function () {
    const { escrow, customer, driver, relayer } = await deployEscrow();
    const preimage = preimageFor("mev-secret-refund-after");
    const amount = ethers.parseEther("1");

    const depositId = await createDeposit(escrow, customer, driver, preimage, amount);

    await escrow.connect(relayer).releaseDepositPrivate(depositId, preimage);
    await expect(escrow.refundDeposit(depositId)).to.be.revertedWith("Already released");
>>>>>>> upstream/main
  });
});
