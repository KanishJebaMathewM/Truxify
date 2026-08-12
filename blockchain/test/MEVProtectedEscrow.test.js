import assert from "node:assert/strict";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
const { ethers } = hre;

async function assertRejectsWith(promise, message) {
  await assert.rejects(promise, error => error.message.includes(message));
}

function commitHashFor(secret, address) {
  return ethers.keccak256(ethers.solidityPacked(["bytes32", "address"], [secret, address]));
}

describe("MEVProtectedEscrow", function () {
  async function deployEscrow() {
    const [owner, customer, driver, outsider] = await ethers.getSigners();
    const Escrow = await ethers.getContractFactory("MEVProtectedEscrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();
    return { escrow, owner, customer, driver, outsider };
  }

  it("allows the full commit -> reveal -> release flow", async function () {
    const { escrow, owner, customer, driver } = await deployEscrow();
    const secret = ethers.id("mev-secret-1");
    const secretHash = commitHashFor(secret, customer.address);
    const amount = ethers.parseEther("1");

    await escrow.connect(customer).createCommitment(secretHash);
    await escrow.connect(customer).createEscrow(driver.address, secretHash, { value: amount });
    await escrow.connect(customer).revealCommitment(secret);

    assert.equal(await escrow.revealedCommits(secretHash), true);
    assert.equal(await escrow.userCommitments(customer.address), secretHash);

    // Advance past the anti-back-running window so release is permitted.
    await time.increase(2);
    const driverBefore = await ethers.provider.getBalance(driver.address);
    const proof = ethers.randomBytes(65);
    await escrow.connect(owner).releaseEscrowWithProof(1, secret, proof, { gasPrice: ethers.parseUnits("1", "gwei") });

    const saved = await escrow.escrows(1);
    assert.equal(saved.released, true);
    assert.equal(saved.revealed, true);
    assert.equal(saved.secret, secret);
    assert.equal(await ethers.provider.getBalance(driver.address) - driverBefore, amount);
  });

  it("rejects a second reveal of the same commitment", async function () {
    const { escrow, customer } = await deployEscrow();
    const secret = ethers.id("mev-secret-2");
    const secretHash = commitHashFor(secret, customer.address);

    await escrow.connect(customer).createCommitment(secretHash);
    await escrow.connect(customer).revealCommitment(secret);
    await assertRejectsWith(escrow.connect(customer).revealCommitment(secret), "Already revealed");
  });

  it("rejects revealing a commitment with the wrong secret", async function () {
    const { escrow, customer } = await deployEscrow();
    const secret = ethers.id("mev-secret-3");
    const wrongSecret = ethers.id("mev-secret-3-wrong");
    const secretHash = commitHashFor(secret, customer.address);

    await escrow.connect(customer).createCommitment(secretHash);
    await assertRejectsWith(escrow.connect(customer).revealCommitment(wrongSecret), "Invalid commit");
    assert.equal(await escrow.revealedCommits(secretHash), false);
  });

  it("rejects releasing an escrow whose commitment was never revealed", async function () {
    const { escrow, owner, customer, driver } = await deployEscrow();
    const secret = ethers.id("mev-secret-4");
    const secretHash = commitHashFor(secret, customer.address);
    const amount = ethers.parseEther("0.5");

    await escrow.connect(customer).createCommitment(secretHash);
    await escrow.connect(customer).createEscrow(driver.address, secretHash, { value: amount });

    await time.increase(2);
    const proof = ethers.randomBytes(65);
    await assertRejectsWith(
      escrow.connect(owner).releaseEscrowWithProof(1, ethers.id("wrong-secret"), proof, { gasPrice: ethers.parseUnits("1", "gwei") }),
      "Invalid secret"
    );
  });
});
