import hre from "hardhat";
const { ethers } = hre;
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

describe("TruxifyEscrow", function () {

  // ─── Fixture ──────────────────────────────────────────────────────────────
  async function deployEscrowFixture() {
    const [owner, customer, driver, attacker] = await ethers.getSigners();

    const TruxifyEscrow = await ethers.getContractFactory("TruxifyEscrow");
    const escrow = await TruxifyEscrow.deploy();

    return { escrow, owner, customer, driver, attacker };
  }

  // ─── createBooking ────────────────────────────────────────────────────────
  describe("createBooking", function () {
    it("locks payment in escrow on booking creation", async function () {
      const { escrow, customer, driver } = await loadFixture(deployEscrowFixture);

      const bookingId = 1;
      const amount = ethers.parseEther("1.0");

      await escrow.connect(customer).createBooking(bookingId, driver.address, {
        value: amount,
      });

      const booking = await escrow.getBooking(bookingId);
      expect(booking.amount).to.equal(amount);
      expect(booking.customer).to.equal(customer.address);
      expect(booking.driver).to.equal(driver.address);
      expect(booking.paid).to.be.false;
    });

    it("reverts if payment is zero", async function () {
      const { escrow, customer, driver } = await loadFixture(deployEscrowFixture);

      await expect(
        escrow.connect(customer).createBooking(1, driver.address, { value: 0 })
      ).to.be.revertedWith("TruxifyEscrow: Payment required");
    });
  });

  // ─── releasePayment ───────────────────────────────────────────────────────
  describe("releasePayment", function () {
    it("releases payment to driver and updates state", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);

      const bookingId = 1;
      const amount = ethers.parseEther("2.0");

      await escrow.connect(customer).createBooking(bookingId, driver.address, {
        value: amount,
      });

      const driverBalanceBefore = await ethers.provider.getBalance(driver.address);

      await escrow.connect(owner).releasePayment(bookingId);

      const booking = await escrow.getBooking(bookingId);
      expect(booking.paid).to.be.true;
      expect(booking.amount).to.equal(0);
      expect(booking.status).to.equal(1); // Delivered

      // Withdraw the funds to driver
      await escrow.connect(driver).withdraw();

      const driverBalanceAfter = await ethers.provider.getBalance(driver.address);
      expect(driverBalanceAfter).to.be.gt(driverBalanceBefore);
    });

    it("reverts if called by non-owner", async function () {
      const { escrow, customer, driver, attacker } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, {
        value: ethers.parseEther("1.0"),
      });

      await expect(
        escrow.connect(attacker).releasePayment(1)
      ).to.be.reverted; // OwnableUnauthorizedAccount
    });

    it("reverts on double payment attempt", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, {
        value: ethers.parseEther("1.0"),
      });

      await escrow.connect(owner).releasePayment(1);

      // Second call must revert
      await expect(
        escrow.connect(owner).releasePayment(1)
      ).to.be.revertedWith("TruxifyEscrow: Booking not active");
    });
  });

  // ─── Re-entrancy Attack Test ──────────────────────────────────────────────
  describe("Re-entrancy protection", function () {
    it("blocks a malicious re-entrant driver contract from draining escrow", async function () {
      const { escrow, owner, customer } = await loadFixture(deployEscrowFixture);

      // Deploy malicious re-entrant contract
      const MaliciousDriver = await ethers.getContractFactory("MaliciousDriver");
      const malicious = await MaliciousDriver.deploy(await escrow.getAddress());

      const bookingId = 99;
      const amount = ethers.parseEther("5.0");

      // Create booking with malicious contract as driver
      await escrow.connect(customer).createBooking(bookingId, await malicious.getAddress(), {
        value: amount,
      });

      // Fund the escrow with extra ETH so drain would be possible without guard
      await owner.sendTransaction({
        to: await escrow.getAddress(),
        value: ethers.parseEther("10.0"),
      });

      // Release payment (succeeds, updates state and registers withdrawal)
      await escrow.connect(owner).releasePayment(bookingId);

      // Attempt re-entrant drain via withdraw — must revert
      await expect(
        malicious.attackWithdraw()
      ).to.be.reverted;

      // Escrow should still hold funds (not drained)
      const escrowBalance = await ethers.provider.getBalance(await escrow.getAddress());
      expect(escrowBalance).to.be.gt(0);
    });
  });

  // ─── cancelBooking ────────────────────────────────────────────────────────
  describe("cancelBooking", function () {
    it("refunds customer on cancellation", async function () {
      const { escrow, customer, driver } = await loadFixture(deployEscrowFixture);

      const amount = ethers.parseEther("1.0");
      await escrow.connect(customer).createBooking(1, driver.address, { value: amount });

      const balanceBefore = await ethers.provider.getBalance(customer.address);
      await escrow.connect(customer).cancelBooking(1);

      // Withdraw refund
      await escrow.connect(customer).withdraw();

      const balanceAfter = await ethers.provider.getBalance(customer.address);

      expect(balanceAfter).to.be.gt(balanceBefore);

      const booking = await escrow.getBooking(1);
      expect(booking.status).to.equal(2); // Cancelled
      expect(booking.amount).to.equal(0);
    });
  });
});