import assert from "node:assert/strict";
import hre from "hardhat";
import { mine } from "@nomicfoundation/hardhat-network-helpers";
const { ethers } = hre;

async function assertRejectsWith(promise, message) {
  await assert.rejects(promise, error => error.message.includes(message));
}

/**
 * The commit/reveal API (createCommitment / createEscrow / revealCommitment /
 * releaseEscrowWithProof) was replaced by the protected-deposit surface:
 * createProtectedDeposit(driver, secretHash) + releaseDepositPrivate(id,
 * preimage) gated on a fixed RELEASE_DELAY_BLOCKS window. The shipper commits
 * keccak256(preimage) as secretHash; the relayer reveals the preimage to
 * release.
 */
function preimageFor(secret) {
  return ethers.keccak256(ethers.toUtf8Bytes(secret));
}

function secretHashFor(preimage) {
  return ethers.keccak256(preimage);
}

describe("MEVProtectedEscrow", function () {
  async function deployEscrow() {
    const [owner, customer, driver, outsider, relayer] = await ethers.getSigners();
    const Escrow = await ethers.getContractFactory("MEVProtectedEscrow");
    const escrow = await Escrow.deploy(relayer.address);
    await escrow.waitForDeployment();
    return { escrow, owner, customer, driver, outsider, relayer };
  }

  it("allows the full commit -> reveal -> release flow", async function () {
    const { escrow, customer, driver, relayer } = await deployEscrow();
    const preimage = preimageFor("mev-secret-1");
    const secretHash = secretHashFor(preimage);
    const amount = ethers.parseEther("1");

    await escrow.connect(customer).createProtectedDeposit(driver.address, secretHash, { value: amount });

    const dep = await escrow.deposits(1);
    assert.equal(dep.secretHash, secretHash);
    assert.equal(dep.released, false);

    // Advance past the anti-front-running release window.
    await mine(20);
    const driverBefore = await ethers.provider.getBalance(driver.address);
    await escrow.connect(relayer).releaseDepositPrivate(1, preimage);

    const saved = await escrow.deposits(1);
    assert.equal(saved.released, true);
    assert.equal(await ethers.provider.getBalance(driver.address) - driverBefore, amount);
  });

  it("rejects a second release of the same deposit", async function () {
    const { escrow, customer, driver, relayer } = await deployEscrow();
    const preimage = preimageFor("mev-secret-2");

    await escrow.connect(customer).createProtectedDeposit(driver.address, secretHashFor(preimage), { value: ethers.parseEther("1") });
    await mine(20);
    await escrow.connect(relayer).releaseDepositPrivate(1, preimage);
    await assertRejectsWith(escrow.connect(relayer).releaseDepositPrivate(1, preimage), "Already released");
  });

  it("rejects releasing with the wrong preimage", async function () {
    const { escrow, customer, driver, relayer } = await deployEscrow();
    const preimage = preimageFor("mev-secret-3");
    const wrongPreimage = preimageFor("mev-secret-3-wrong");

    await escrow.connect(customer).createProtectedDeposit(driver.address, secretHashFor(preimage), { value: ethers.parseEther("1") });
    await mine(20);
    await assertRejectsWith(escrow.connect(relayer).releaseDepositPrivate(1, wrongPreimage), "Invalid preimage");
    assert.equal((await escrow.deposits(1)).released, false);
  });

  it("rejects releasing a deposit before the release window opens", async function () {
    const { escrow, customer, driver, relayer } = await deployEscrow();
    const preimage = preimageFor("mev-secret-4");

    await escrow.connect(customer).createProtectedDeposit(driver.address, secretHashFor(preimage), { value: ethers.parseEther("0.5") });

    await assertRejectsWith(
      escrow.connect(relayer).releaseDepositPrivate(1, preimage),
      "Release window not open"
    );
  });
});
