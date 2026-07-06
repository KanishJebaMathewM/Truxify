import assert from "node:assert/strict";
import hre from "hardhat";
const { ethers } = hre;

async function assertRejectsWith(promise, message) {
  await assert.rejects(promise, error => error.message.includes(message));
}

function bookingId(label) {
  return ethers.id(label);
}

describe("Escrow", function () {
  async function deployEscrow() {
    const [owner, relayer, customer, driver, outsider] = await ethers.getSigners();
    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy(relayer.address);
    await escrow.waitForDeployment();
    return { escrow, owner, relayer, customer, driver, outsider };
  }

  it("accepts deposits and records funded escrow state", async function () {
    const { escrow, customer, driver } = await deployEscrow();
    const id = bookingId("booking-1");
    const amount = ethers.parseEther("1");

    await escrow.connect(customer).deposit(id, customer.address, driver.address, { value: amount });
    const saved = await escrow.escrows(id);

    assert.equal(saved.customer, customer.address);
    assert.equal(saved.driver, driver.address);
    assert.equal(saved.amount, amount);
    assert.equal(saved.status, 1n);
    assert.equal(await ethers.provider.getBalance(await escrow.getAddress()), amount);
  });

  it("releases funds to the driver through an authorized relayer", async function () {
    const { escrow, relayer, customer, driver } = await deployEscrow();
    const id = bookingId("booking-release");
    const amount = ethers.parseEther("0.25");
    await escrow.connect(customer).deposit(id, customer.address, driver.address, { value: amount });

    const driverBefore = await ethers.provider.getBalance(driver.address);
    await escrow.connect(relayer).releaseFunds(id);
    const driverAfter = await ethers.provider.getBalance(driver.address);
    const saved = await escrow.escrows(id);

    assert.equal(driverAfter - driverBefore, amount);
    assert.equal(saved.status, 2n);
    assert.equal(saved.amount, 0n);
  });

  it("refunds funds to the customer through an authorized relayer", async function () {
    const { escrow, relayer, customer, driver } = await deployEscrow();
    const id = bookingId("booking-refund");
    const amount = ethers.parseEther("0.25");
    await escrow.connect(customer).deposit(id, customer.address, driver.address, { value: amount });

    await escrow.connect(relayer).refundFunds(id);
    const saved = await escrow.escrows(id);

    assert.equal(saved.status, 3n);
    assert.equal(saved.amount, 0n);
    assert.equal(await ethers.provider.getBalance(await escrow.getAddress()), 0n);
  });

  it("blocks double release and double refund attempts", async function () {
    const { escrow, relayer, customer, driver } = await deployEscrow();
    const releaseId = bookingId("double-release");
    const refundId = bookingId("double-refund");

    await escrow.connect(customer).deposit(releaseId, customer.address, driver.address, { value: 1000n });
    await escrow.connect(relayer).releaseFunds(releaseId);
    await assertRejectsWith(escrow.connect(relayer).releaseFunds(releaseId), "Escrow not funded");

    await escrow.connect(customer).deposit(refundId, customer.address, driver.address, { value: 1000n });
    await escrow.connect(relayer).refundFunds(refundId);
    await assertRejectsWith(escrow.connect(relayer).refundFunds(refundId), "Escrow not funded");
  });

  it("rejects unauthorized release and refund attempts", async function () {
    const { escrow, customer, driver, outsider } = await deployEscrow();
    const id = bookingId("unauthorized");
    await escrow.connect(customer).deposit(id, customer.address, driver.address, { value: 1000n });

    await assertRejectsWith(escrow.connect(outsider).releaseFunds(id), "Not authorized relayer");
    await assertRejectsWith(escrow.connect(outsider).refundFunds(id), "Not authorized relayer");
  });

  it("rejects deposit from non-customer wallets (relayer / outsider)", async function () {
    const { escrow, relayer, customer, driver, outsider } = await deployEscrow();
    const id = bookingId("only-customer-deposit");
    const amount = ethers.parseEther("0.1");

    await assertRejectsWith(
      escrow.connect(relayer).deposit(id, customer.address, driver.address, { value: amount }),
      "Only customer can deposit"
    );
    await assertRejectsWith(
      escrow.connect(outsider).deposit(id, customer.address, driver.address, { value: amount }),
      "Only customer can deposit"
    );
    const tx = await escrow.connect(customer).deposit(id, customer.address, driver.address, { value: amount });
    await tx.wait();  // should succeed
  });

  it("blocks invalid state transitions and duplicate deposits", async function () {
    const { escrow, relayer, customer, driver } = await deployEscrow();
    const id = bookingId("invalid-state");

    await assertRejectsWith(escrow.connect(relayer).releaseFunds(id), "Escrow not funded");
    await escrow.connect(customer).deposit(id, customer.address, driver.address, { value: 1000n });
    await assertRejectsWith(
      escrow.connect(customer).deposit(id, customer.address, driver.address, { value: 1000n }),
      "Escrow exists"
    );
  });

  it("prevents reentrancy during driver payout", async function () {
    const { escrow, owner, customer } = await deployEscrow();
    const ReentrantDriver = await ethers.getContractFactory("ReentrantDriver");
    const attacker = await ReentrantDriver.deploy(await escrow.getAddress());
    await attacker.waitForDeployment();

    const id = bookingId("reentrant-booking");
    await escrow.connect(owner).setRelayer(await attacker.getAddress(), true);
    await escrow.connect(customer).deposit(id, customer.address, await attacker.getAddress(), { value: 1000n });

    await assertRejectsWith(attacker.attackRelease(id), "Driver payout failed");
  });
});

// blockchain/test/Escrow.test.js
// Tests for Issue #<number>: Verify escrow payment lifecycle

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Escrow Contract", function () {
  let escrow;
  let owner;
  let driver;
  let customer;
  const LOAD_AMOUNT = ethers.parseEther("1.0"); // 1 MATIC

  beforeEach(async function () {
    // Get test wallets (Hardhat provides 20 funded test accounts automatically)
    [owner, customer, driver] = await ethers.getSigners();

    // Deploy a fresh contract before each test
    // ⚠️ Replace "Escrow" with your actual contract name from Escrow.sol
    const EscrowFactory = await ethers.getContractFactory("Escrow");
    escrow = await EscrowFactory.deploy();
    await escrow.waitForDeployment();
  });

  it("Should deploy successfully and have correct owner", async function () {
    expect(await escrow.getAddress()).to.be.properAddress;
  });

  it("Customer can fund escrow for a load booking", async function () {
    // ⚠️ Replace "fundEscrow" with your actual function name
    const tx = await escrow.connect(customer).fundEscrow(driver.address, {
      value: LOAD_AMOUNT,
    });
    await tx.wait();

    // Verify escrow holds the funds
    const balance = await ethers.provider.getBalance(await escrow.getAddress());
    expect(balance).to.equal(LOAD_AMOUNT);
  });

  it("Driver receives payment after delivery confirmation", async function () {
    // Fund escrow
    await escrow.connect(customer).fundEscrow(driver.address, {
      value: LOAD_AMOUNT,
    });

    const driverBalanceBefore = await ethers.provider.getBalance(driver.address);

    // ⚠️ Replace "confirmDelivery" with your actual function name
    await escrow.connect(customer).confirmDelivery();

    const driverBalanceAfter = await ethers.provider.getBalance(driver.address);

    // Driver should have received the LOAD_AMOUNT (minus gas)
    expect(driverBalanceAfter).to.be.greaterThan(driverBalanceBefore);
  });

  it("Customer can cancel and get refund before delivery", async function () {
    await escrow.connect(customer).fundEscrow(driver.address, {
      value: LOAD_AMOUNT,
    });

    const customerBalanceBefore = await ethers.provider.getBalance(customer.address);

    // ⚠️ Replace "cancelAndRefund" with your actual function name
    await escrow.connect(customer).cancelAndRefund();

    const customerBalanceAfter = await ethers.provider.getBalance(customer.address);
    expect(customerBalanceAfter).to.be.greaterThan(customerBalanceBefore);
  });

  it("Unauthorized caller cannot release payment", async function () {
    await escrow.connect(customer).fundEscrow(driver.address, {
      value: LOAD_AMOUNT,
    });

    // A random third party should NOT be able to release funds
    await expect(
      escrow.connect(owner).confirmDelivery()
    ).to.be.revertedWith("Not authorized"); // adjust to your actual revert message
  });
});