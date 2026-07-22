import hre from "hardhat";
const { ethers } = hre;
import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

describe("TruxifyEscrow", function () {

  // ─── Fixture ──────────────────────────────────────────────────────────────
  async function deployEscrowFixture() {
    const [owner, customer, driver, attacker] = await ethers.getSigners();

    const TruxifyEscrow = await ethers.getContractFactory("TruxifyEscrow");
    const escrow = await TruxifyEscrow.deploy();

    return { escrow, owner, customer, driver, attacker };
  }

  async function deployWithBookingFixture() {
    const { escrow, owner, customer, driver, attacker } = await loadFixture(deployEscrowFixture);
    const bookingId = 1;
    const amount = ethers.parseEther("1.0");

    await escrow.connect(customer).createBooking(bookingId, driver.address, { value: amount });

    return { escrow, owner, customer, driver, attacker, bookingId, amount };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // createBooking
  // ═══════════════════════════════════════════════════════════════════════════
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
      expect(booking.status).to.equal(0); // Active
    });

    it("increments bookingCount", async function () {
      const { escrow, customer, driver } = await loadFixture(deployEscrowFixture);

      expect(await escrow.bookingCount()).to.equal(0);

      await escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1") });
      expect(await escrow.bookingCount()).to.equal(1);

      await escrow.connect(customer).createBooking(2, driver.address, { value: ethers.parseEther("1") });
      expect(await escrow.bookingCount()).to.equal(2);
    });

    it("records createdAt timestamp", async function () {
      const { escrow, customer, driver } = await loadFixture(deployEscrowFixture);

      const tx = await escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1") });
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      const booking = await escrow.getBooking(1);
      expect(booking.createdAt).to.equal(block.timestamp);
    });

    it("emits BookingCreated event", async function () {
      const { escrow, customer, driver } = await loadFixture(deployEscrowFixture);

      const bookingId = 42;
      const amount = ethers.parseEther("2.5");

      await expect(
        escrow.connect(customer).createBooking(bookingId, driver.address, { value: amount })
      )
        .to.emit(escrow, "BookingCreated")
        .withArgs(bookingId, customer.address, driver.address, amount);
    });

    it("reverts if payment is zero", async function () {
      const { escrow, customer, driver } = await loadFixture(deployEscrowFixture);

      await expect(
        escrow.connect(customer).createBooking(1, driver.address, { value: 0 })
      ).to.be.revertedWith("TruxifyEscrow: Payment required");
    });

    it("reverts if driver is zero address", async function () {
      const { escrow, customer } = await loadFixture(deployEscrowFixture);

      await expect(
        escrow.connect(customer).createBooking(1, ethers.ZeroAddress, { value: ethers.parseEther("1") })
      ).to.be.revertedWith("TruxifyEscrow: Invalid driver address");
    });

    it("reverts if booking already exists", async function () {
      const { escrow, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1") });

      await expect(
        escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1") })
      ).to.be.revertedWith("TruxifyEscrow: Booking already exists");
    });

    it("stores correct booking for each ID", async function () {
      const { escrow, customer, driver } = await loadFixture(deployEscrowFixture);

      const addr1 = "0x0000000000000000000000000000000000000001";
      const addr2 = "0x0000000000000000000000000000000000000002";

      await escrow.connect(customer).createBooking(100, driver.address, { value: ethers.parseEther("1") });
      await escrow.connect(customer).createBooking(200, addr2, { value: ethers.parseEther("2") });

      const booking1 = await escrow.getBooking(100);
      const booking2 = await escrow.getBooking(200);

      expect(booking1.driver).to.equal(driver.address);
      expect(booking1.amount).to.equal(ethers.parseEther("1"));
      expect(booking2.driver).to.equal(addr2);
      expect(booking2.amount).to.equal(ethers.parseEther("2"));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // releasePayment
  // ═══════════════════════════════════════════════════════════════════════════
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

    it("adds amount to driver pendingWithdrawals", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);
      const amount = ethers.parseEther("3.0");

      await escrow.connect(customer).createBooking(1, driver.address, { value: amount });
      await escrow.connect(owner).releasePayment(1);

      expect(await escrow.pendingWithdrawals(driver.address)).to.equal(amount);
    });

    it("sets releaseTimestamps for driver", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1") });

      const tx = await escrow.connect(owner).releasePayment(1);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      const releaseTs = await escrow.releaseTimestamps(driver.address);
      expect(releaseTs).to.equal(block.timestamp + 30 * 24 * 60 * 60); // 30 days
    });

    it("emits WithdrawalReady and PaymentReleased events", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);
      const bookingId = 7;
      const amount = ethers.parseEther("1.5");

      await escrow.connect(customer).createBooking(bookingId, driver.address, { value: amount });

      const tx = escrow.connect(owner).releasePayment(bookingId);

      await expect(tx)
        .to.emit(escrow, "WithdrawalReady")
        .withArgs(bookingId, driver.address, amount);
      await expect(tx)
        .to.emit(escrow, "PaymentReleased")
        .withArgs(bookingId, driver.address, amount);
    });

    it("reverts if called by non-owner", async function () {
      const { escrow, customer, driver, attacker } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, {
        value: ethers.parseEther("1.0"),
      });

      await expect(
        escrow.connect(attacker).releasePayment(1)
      ).to.be.reverted;
    });

    it("reverts if called by customer", async function () {
      const { escrow, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, {
        value: ethers.parseEther("1.0"),
      });

      await expect(
        escrow.connect(customer).releasePayment(1)
      ).to.be.reverted;
    });

    it("reverts on double payment attempt", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, {
        value: ethers.parseEther("1.0"),
      });

      await escrow.connect(owner).releasePayment(1);

      await expect(
        escrow.connect(owner).releasePayment(1)
      ).to.be.revertedWith("TruxifyEscrow: Booking not active");
    });

    it("reverts if booking is cancelled", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, {
        value: ethers.parseEther("1.0"),
      });
      await escrow.connect(customer).cancelBooking(1);

      await expect(
        escrow.connect(owner).releasePayment(1)
      ).to.be.revertedWith("TruxifyEscrow: Booking not active");
    });

    it("reverts if booking is disputed", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, {
        value: ethers.parseEther("1.0"),
      });
      await escrow.connect(customer).raiseDispute(1);

      await expect(
        escrow.connect(owner).releasePayment(1)
      ).to.be.revertedWith("TruxifyEscrow: Booking not active");
    });

    it("reverts for non-existent booking", async function () {
      const { escrow, owner } = await loadFixture(deployEscrowFixture);

      // Non-existent booking has status=0 (Active), paid=false, amount=0
      // So it passes "Booking not active" and "Already paid" checks, hits "Nothing to release"
      await expect(
        escrow.connect(owner).releasePayment(999)
      ).to.be.revertedWith("TruxifyEscrow: Nothing to release");
    });

    it("reverts when contract is paused", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, {
        value: ethers.parseEther("1.0"),
      });
      await escrow.connect(owner).pause();

      await expect(
        escrow.connect(owner).releasePayment(1)
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });

    it("handles multiple bookings independently", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1") });
      await escrow.connect(customer).createBooking(2, driver.address, { value: ethers.parseEther("2") });

      await escrow.connect(owner).releasePayment(1);

      const booking1 = await escrow.getBooking(1);
      const booking2 = await escrow.getBooking(2);

      expect(booking1.paid).to.be.true;
      expect(booking2.paid).to.be.false;
      expect(booking2.amount).to.equal(ethers.parseEther("2"));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Re-entrancy protection
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Re-entrancy protection", function () {
    it("blocks a malicious re-entrant driver contract from draining escrow", async function () {
      const { escrow, owner, customer } = await loadFixture(deployEscrowFixture);

      const MaliciousDriver = await ethers.getContractFactory("MaliciousDriver");
      const malicious = await MaliciousDriver.deploy(await escrow.getAddress());

      const bookingId = 99;
      const amount = ethers.parseEther("5.0");

      await escrow.connect(customer).createBooking(bookingId, await malicious.getAddress(), {
        value: amount,
      });

      await owner.sendTransaction({
        to: await escrow.getAddress(),
        value: ethers.parseEther("10.0"),
      });

      await escrow.connect(owner).releasePayment(bookingId);

      await expect(
        malicious.attackWithdraw()
      ).to.be.reverted;

      const escrowBalance = await ethers.provider.getBalance(await escrow.getAddress());
      expect(escrowBalance).to.be.gt(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // cancelBooking
  // ═══════════════════════════════════════════════════════════════════════════
  describe("cancelBooking", function () {
    it("refunds customer on cancellation", async function () {
      const { escrow, customer, driver } = await loadFixture(deployEscrowFixture);

      const amount = ethers.parseEther("1.0");
      await escrow.connect(customer).createBooking(1, driver.address, { value: amount });

      const balanceBefore = await ethers.provider.getBalance(customer.address);
      await escrow.connect(customer).cancelBooking(1);

      await escrow.connect(customer).withdraw();

      const balanceAfter = await ethers.provider.getBalance(customer.address);
      expect(balanceAfter).to.be.gt(balanceBefore);

      const booking = await escrow.getBooking(1);
      expect(booking.status).to.equal(2); // Cancelled
      expect(booking.amount).to.equal(0);
    });

    it("allows owner to cancel booking", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1") });
      await escrow.connect(owner).cancelBooking(1);

      const booking = await escrow.getBooking(1);
      expect(booking.status).to.equal(2);
    });

    it("adds refund to customer pendingWithdrawals", async function () {
      const { escrow, customer, driver } = await loadFixture(deployEscrowFixture);
      const amount = ethers.parseEther("2.5");

      await escrow.connect(customer).createBooking(1, driver.address, { value: amount });
      await escrow.connect(customer).cancelBooking(1);

      expect(await escrow.pendingWithdrawals(customer.address)).to.equal(amount);
    });

    it("sets releaseTimestamps for customer", async function () {
      const { escrow, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1") });

      const tx = await escrow.connect(customer).cancelBooking(1);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      const releaseTs = await escrow.releaseTimestamps(customer.address);
      expect(releaseTs).to.equal(block.timestamp + 30 * 24 * 60 * 60);
    });

    it("emits BookingCancelled and WithdrawalReady events", async function () {
      const { escrow, customer, driver } = await loadFixture(deployEscrowFixture);
      const amount = ethers.parseEther("1.5");

      await escrow.connect(customer).createBooking(5, driver.address, { value: amount });

      const tx = escrow.connect(customer).cancelBooking(5);

      await expect(tx)
        .to.emit(escrow, "BookingCancelled")
        .withArgs(5, customer.address, amount);
      await expect(tx)
        .to.emit(escrow, "WithdrawalReady")
        .withArgs(5, customer.address, amount);
    });

    it("reverts if not customer or owner", async function () {
      const { escrow, customer, driver, attacker } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, {
        value: ethers.parseEther("1.0"),
      });

      await expect(
        escrow.connect(attacker).cancelBooking(1)
      ).to.be.revertedWith("TruxifyEscrow: Not authorised");
    });

    it("reverts if driver tries to cancel", async function () {
      const { escrow, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, {
        value: ethers.parseEther("1.0"),
      });

      await expect(
        escrow.connect(driver).cancelBooking(1)
      ).to.be.revertedWith("TruxifyEscrow: Not authorised");
    });

    it("reverts if booking is already paid", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, {
        value: ethers.parseEther("1.0"),
      });
      await escrow.connect(owner).releasePayment(1);

      // After release, status is Delivered (1), so "Cannot cancel - booking not active" fires first
      await expect(
        escrow.connect(customer).cancelBooking(1)
      ).to.be.revertedWith("TruxifyEscrow: Cannot cancel - booking not active");
    });

    it("reverts for non-existent booking", async function () {
      const { escrow, attacker } = await loadFixture(deployEscrowFixture);

      // Non-existent booking has zero customer, so "Not authorised" fires first
      await expect(
        escrow.connect(attacker).cancelBooking(999)
      ).to.be.revertedWith("TruxifyEscrow: Not authorised");
    });

    it("reverts when contract is paused", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, {
        value: ethers.parseEther("1.0"),
      });
      await escrow.connect(owner).pause();

      await expect(
        escrow.connect(customer).cancelBooking(1)
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // raiseDispute
  // ═══════════════════════════════════════════════════════════════════════════
  describe("raiseDispute", function () {
    it("allows customer to raise dispute", async function () {
      const { escrow, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1") });
      await escrow.connect(customer).raiseDispute(1);

      const booking = await escrow.getBooking(1);
      expect(booking.status).to.equal(3); // Disputed
    });

    it("allows driver to raise dispute", async function () {
      const { escrow, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1") });
      await escrow.connect(driver).raiseDispute(1);

      const booking = await escrow.getBooking(1);
      expect(booking.status).to.equal(3);
    });

    it("emits BookingDisputed event with correct args", async function () {
      const { escrow, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1") });

      // Customer raises dispute on booking 1
      await expect(escrow.connect(customer).raiseDispute(1))
        .to.emit(escrow, "BookingDisputed")
        .withArgs(1, customer.address);

      // Create a second booking and have driver raise dispute
      await escrow.connect(customer).createBooking(2, driver.address, { value: ethers.parseEther("1") });
      await expect(escrow.connect(driver).raiseDispute(2))
        .to.emit(escrow, "BookingDisputed")
        .withArgs(2, driver.address);
    });

    it("reverts if caller is not a party to the booking", async function () {
      const { escrow, customer, driver, attacker } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1") });

      await expect(
        escrow.connect(attacker).raiseDispute(1)
      ).to.be.revertedWith("TruxifyEscrow: Not a party to this booking");
    });

    it("reverts if owner tries to raise dispute", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1") });

      await expect(
        escrow.connect(owner).raiseDispute(1)
      ).to.be.revertedWith("TruxifyEscrow: Not a party to this booking");
    });

    it("reverts if booking is not active", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1") });
      await escrow.connect(owner).releasePayment(1);

      await expect(
        escrow.connect(customer).raiseDispute(1)
      ).to.be.revertedWith("TruxifyEscrow: Cannot dispute - booking not active");
    });

    it("reverts if booking is already cancelled", async function () {
      const { escrow, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1") });
      await escrow.connect(customer).cancelBooking(1);

      await expect(
        escrow.connect(customer).raiseDispute(1)
      ).to.be.revertedWith("TruxifyEscrow: Cannot dispute - booking not active");
    });

    it("reverts for non-existent booking", async function () {
      const { escrow, customer } = await loadFixture(deployEscrowFixture);

      await expect(
        escrow.connect(customer).raiseDispute(999)
      ).to.be.revertedWith("TruxifyEscrow: Not a party to this booking");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // withdraw
  // ═══════════════════════════════════════════════════════════════════════════
  describe("withdraw", function () {
    it("allows driver to withdraw released funds", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);
      const amount = ethers.parseEther("2.0");

      await escrow.connect(customer).createBooking(1, driver.address, { value: amount });
      await escrow.connect(owner).releasePayment(1);

      const before = await ethers.provider.getBalance(driver.address);
      const tx = await escrow.connect(driver).withdraw();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const after = await ethers.provider.getBalance(driver.address);

      expect(after + gasUsed - before).to.equal(amount);
      expect(await escrow.pendingWithdrawals(driver.address)).to.equal(0);
    });

    it("allows customer to withdraw cancelled refund", async function () {
      const { escrow, customer, driver } = await loadFixture(deployEscrowFixture);
      const amount = ethers.parseEther("1.5");

      await escrow.connect(customer).createBooking(1, driver.address, { value: amount });
      await escrow.connect(customer).cancelBooking(1);

      const before = await ethers.provider.getBalance(customer.address);
      const tx = await escrow.connect(customer).withdraw();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const after = await ethers.provider.getBalance(customer.address);

      expect(after + gasUsed - before).to.equal(amount);
    });

    it("emits Withdrawn event", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);
      const amount = ethers.parseEther("1.0");

      await escrow.connect(customer).createBooking(1, driver.address, { value: amount });
      await escrow.connect(owner).releasePayment(1);

      await expect(escrow.connect(driver).withdraw())
        .to.emit(escrow, "Withdrawn")
        .withArgs(driver.address, amount);
    });

    it("clears releaseTimestamps after withdrawal", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1") });
      await escrow.connect(owner).releasePayment(1);

      expect(await escrow.releaseTimestamps(driver.address)).to.be.gt(0);

      await escrow.connect(driver).withdraw();

      expect(await escrow.releaseTimestamps(driver.address)).to.equal(0);
    });

    it("reverts if nothing to withdraw", async function () {
      const { escrow, attacker } = await loadFixture(deployEscrowFixture);

      await expect(
        escrow.connect(attacker).withdraw()
      ).to.be.revertedWith("Nothing to withdraw");
    });

    it("reverts when contract is paused", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1") });
      await escrow.connect(owner).releasePayment(1);
      await escrow.connect(owner).pause();

      await expect(
        escrow.connect(driver).withdraw()
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });

    it("allows multiple withdrawals from different bookings", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);
      const amount1 = ethers.parseEther("1");
      const amount2 = ethers.parseEther("2");

      await escrow.connect(customer).createBooking(1, driver.address, { value: amount1 });
      await escrow.connect(customer).createBooking(2, driver.address, { value: amount2 });
      await escrow.connect(owner).releasePayment(1);
      await escrow.connect(owner).releasePayment(2);

      expect(await escrow.pendingWithdrawals(driver.address)).to.equal(amount1 + amount2);

      const before = await ethers.provider.getBalance(driver.address);
      const tx = await escrow.connect(driver).withdraw();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const after = await ethers.provider.getBalance(driver.address);

      expect(after + gasUsed - before).to.equal(amount1 + amount2);
      expect(await escrow.pendingWithdrawals(driver.address)).to.equal(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // emergencyRecover
  // ═══════════════════════════════════════════════════════════════════════════
  describe("emergencyRecover", function () {
    it("allows owner to recover after timeout", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);
      const amount = ethers.parseEther("1.0");

      await escrow.connect(customer).createBooking(1, driver.address, { value: amount });
      await escrow.connect(owner).releasePayment(1);

      // Fast-forward past withdrawal timeout (30 days)
      await time.increase(30 * 24 * 60 * 60 + 1);

      const before = await ethers.provider.getBalance(driver.address);
      await escrow.connect(owner).emergencyRecover(driver.address, amount);
      const after = await ethers.provider.getBalance(driver.address);

      expect(after - before).to.equal(amount);
      expect(await escrow.pendingWithdrawals(driver.address)).to.equal(0);
    });

    it("emits EmergencyRecovered event", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);
      const amount = ethers.parseEther("0.5");

      await escrow.connect(customer).createBooking(1, driver.address, { value: amount });
      await escrow.connect(owner).releasePayment(1);

      await time.increase(30 * 24 * 60 * 60 + 1);

      await expect(escrow.connect(owner).emergencyRecover(driver.address, amount))
        .to.emit(escrow, "EmergencyRecovered")
        .withArgs(driver.address, amount);
    });

    it("reverts if called by non-owner", async function () {
      const { escrow, owner, customer, driver, attacker } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1") });
      await escrow.connect(owner).releasePayment(1);

      await time.increase(30 * 24 * 60 * 60 + 1);

      await expect(
        escrow.connect(attacker).emergencyRecover(driver.address, ethers.parseEther("1"))
      ).to.be.reverted;
    });

    it("reverts if recipient is zero address", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1") });
      await escrow.connect(owner).releasePayment(1);

      await time.increase(30 * 24 * 60 * 60 + 1);

      await expect(
        escrow.connect(owner).emergencyRecover(ethers.ZeroAddress, ethers.parseEther("1"))
      ).to.be.revertedWith("Invalid recipient");
    });

    it("reverts if withdrawal period is still active", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1") });
      await escrow.connect(owner).releasePayment(1);

      // Don't fast-forward — timeout hasn't passed
      await expect(
        escrow.connect(owner).emergencyRecover(driver.address, ethers.parseEther("1"))
      ).to.be.revertedWith("Withdrawal period active");
    });

    it("reverts if amount exceeds pending withdrawals", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1") });
      await escrow.connect(owner).releasePayment(1);

      await time.increase(30 * 24 * 60 * 60 + 1);

      await expect(
        escrow.connect(owner).emergencyRecover(driver.address, ethers.parseEther("2"))
      ).to.be.revertedWith("Insufficient pending");
    });

    it("reverts if recipient has no pending withdrawals", async function () {
      const { escrow, owner, attacker } = await loadFixture(deployEscrowFixture);

      await expect(
        escrow.connect(owner).emergencyRecover(attacker.address, ethers.parseEther("1"))
      ).to.be.revertedWith("Insufficient pending");
    });

    it("allows partial recovery", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);
      const amount = ethers.parseEther("2.0");

      await escrow.connect(customer).createBooking(1, driver.address, { value: amount });
      await escrow.connect(owner).releasePayment(1);

      await time.increase(30 * 24 * 60 * 60 + 1);

      await escrow.connect(owner).emergencyRecover(driver.address, ethers.parseEther("0.5"));

      expect(await escrow.pendingWithdrawals(driver.address)).to.equal(ethers.parseEther("1.5"));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // pause / unpause
  // ═══════════════════════════════════════════════════════════════════════════
  describe("pause / unpause", function () {
    it("owner can pause the contract", async function () {
      const { escrow, owner } = await loadFixture(deployEscrowFixture);

      await escrow.connect(owner).pause();
      expect(await escrow.paused()).to.be.true;
    });

    it("owner can unpause the contract", async function () {
      const { escrow, owner } = await loadFixture(deployEscrowFixture);

      await escrow.connect(owner).pause();
      await escrow.connect(owner).unpause();
      expect(await escrow.paused()).to.be.false;
    });

    it("reverts if non-owner tries to pause", async function () {
      const { escrow, customer } = await loadFixture(deployEscrowFixture);

      await expect(
        escrow.connect(customer).pause()
      ).to.be.reverted;
    });

    it("reverts if non-owner tries to unpause", async function () {
      const { escrow, owner, customer } = await loadFixture(deployEscrowFixture);

      await escrow.connect(owner).pause();

      await expect(
        escrow.connect(customer).unpause()
      ).to.be.reverted;
    });

    it("createBooking still works when paused (no whenNotPaused guard)", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(owner).pause();

      // createBooking has no whenNotPaused modifier, so this succeeds
      await escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1") });
      const booking = await escrow.getBooking(1);
      expect(booking.amount).to.equal(ethers.parseEther("1"));
    });

    it("allows operations after unpause", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(owner).pause();
      await escrow.connect(owner).unpause();

      await escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1") });
      const booking = await escrow.getBooking(1);
      expect(booking.amount).to.equal(ethers.parseEther("1"));
    });

    it("prevents withdrawal when paused", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1") });
      await escrow.connect(owner).releasePayment(1);
      await escrow.connect(owner).pause();

      await expect(
        escrow.connect(driver).withdraw()
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });

    it("prevents cancellation when paused", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1") });
      await escrow.connect(owner).pause();

      await expect(
        escrow.connect(customer).cancelBooking(1)
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // receive / fallback
  // ═══════════════════════════════════════════════════════════════════════════
  describe("receive / fallback", function () {
    it("accepts direct ETH transfers", async function () {
      const { escrow, owner } = await loadFixture(deployEscrowFixture);

      const amount = ethers.parseEther("5.0");
      await owner.sendTransaction({ to: await escrow.getAddress(), value: amount });

      const balance = await ethers.provider.getBalance(await escrow.getAddress());
      expect(balance).to.equal(amount);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getBooking
  // ═══════════════════════════════════════════════════════════════════════════
  describe("getBooking", function () {
    it("returns empty booking for non-existent ID", async function () {
      const { escrow } = await loadFixture(deployEscrowFixture);

      const booking = await escrow.getBooking(999);
      expect(booking.customer).to.equal(ethers.ZeroAddress);
      expect(booking.amount).to.equal(0);
      expect(booking.paid).to.be.false;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // WITHDRAWAL_TIMEOUT constant
  // ═══════════════════════════════════════════════════════════════════════════
  describe("constants", function () {
    it("WITHDRAWAL_TIMEOUT is 30 days", async function () {
      const { escrow } = await loadFixture(deployEscrowFixture);
      const timeout = await escrow.WITHDRAWAL_TIMEOUT();
      expect(timeout).to.equal(30 * 24 * 60 * 60);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Constructor
  // ═══════════════════════════════════════════════════════════════════════════
  describe("constructor", function () {
    it("sets deployer as owner", async function () {
      const { escrow, owner } = await loadFixture(deployEscrowFixture);
      expect(await escrow.owner()).to.equal(owner.address);
    });

    it("starts with zero bookingCount", async function () {
      const { escrow } = await loadFixture(deployEscrowFixture);
      expect(await escrow.bookingCount()).to.equal(0);
    });

    it("starts unpaused", async function () {
      const { escrow } = await loadFixture(deployEscrowFixture);
      expect(await escrow.paused()).to.be.false;
    });
  });

  // ─── Security: Zero Timestamp Protection ─────────────────────────────────
  describe("Zero timestamp protection", function () {
    it("blocks emergency recovery when releaseTimestamp is 0 (never set)", async function () {
      const { escrow, owner, driver } = await loadFixture(deployEscrowFixture);

      await expect(
        escrow.connect(owner).emergencyRecover(driver.address, 1)
      ).to.be.revertedWith("No pending withdrawal");
    });

    it("blocks emergency recovery after withdraw resets timestamp to 0", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);

      const amount = ethers.parseEther("1.0");
      await escrow.connect(customer).createBooking(1, driver.address, { value: amount });
      await escrow.connect(owner).releasePayment(1);
      await escrow.connect(driver).withdraw();

      // Timestamp is now 0 — emergencyRecover must be blocked
      await expect(
        escrow.connect(owner).emergencyRecover(driver.address, 1)
      ).to.be.revertedWith("No pending withdrawal");
    });

    it("allows emergency recovery after legitimate timeout expiry", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);

      const amount = ethers.parseEther("1.0");
      await escrow.connect(customer).createBooking(1, driver.address, { value: amount });
      await escrow.connect(owner).releasePayment(1);

      const WITHDRAWAL_TIMEOUT = await escrow.WITHDRAWAL_TIMEOUT();
      await time.increase(WITHDRAWAL_TIMEOUT + 1n);

      await escrow.connect(owner).emergencyRecover(driver.address, amount);
      expect(await ethers.provider.getBalance(driver.address)).to.be.gt(0n);
    });

    it("reverts emergency recovery before timeout", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);

      const amount = ethers.parseEther("1.0");
      await escrow.connect(customer).createBooking(1, driver.address, { value: amount });
      await escrow.connect(owner).releasePayment(1);

      await expect(
        escrow.connect(owner).emergencyRecover(driver.address, amount)
      ).to.be.revertedWith("Withdrawal period active");
    });
  });

  // ─── Security: Concurrent Booking Timestamp ──────────────────────────────
  describe("Concurrent booking timestamp handling", function () {
    it("preserves earliest deadline for driver with multiple payment releases", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);

      // First booking for driver — sets deadline D1
      await escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1.0") });
      await escrow.connect(owner).releasePayment(1);
      const deadline1 = await escrow.releaseTimestamps(driver.address);

      // Advance time a bit
      await time.increase(3600); // 1 hour

      // Second booking for same driver — must NOT extend deadline
      await escrow.connect(customer).createBooking(2, driver.address, { value: ethers.parseEther("2.0") });
      await escrow.connect(owner).releasePayment(2);
      const deadline2 = await escrow.releaseTimestamps(driver.address);

      expect(deadline2).to.equal(deadline1);
    });

    it("preserves earliest deadline for customer with multiple cancellations", async function () {
      const { escrow, customer, driver } = await loadFixture(deployEscrowFixture);

      // First booking for customer — sets deadline D1
      await escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1.0") });
      await escrow.connect(customer).cancelBooking(1);
      const deadline1 = await escrow.releaseTimestamps(customer.address);

      // Advance time
      await time.increase(3600);

      // Second booking for same customer — must NOT extend deadline
      await escrow.connect(customer).createBooking(2, driver.address, { value: ethers.parseEther("2.0") });
      await escrow.connect(customer).cancelBooking(2);
      const deadline2 = await escrow.releaseTimestamps(customer.address);

      expect(deadline2).to.equal(deadline1);
    });

    it("sets fresh timestamp after withdraw clears existing one", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);

      // First booking — release, withdraw (clears timestamp)
      await escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1.0") });
      await escrow.connect(owner).releasePayment(1);
      await escrow.connect(driver).withdraw();

      // Timestamp should be 0 after withdraw
      expect(await escrow.releaseTimestamps(driver.address)).to.equal(0n);

      // Second booking — must set a fresh timestamp
      await escrow.connect(customer).createBooking(2, driver.address, { value: ethers.parseEther("2.0") });
      await escrow.connect(owner).releasePayment(2);
      const newDeadline = await escrow.releaseTimestamps(driver.address);
      expect(newDeadline).to.be.gt(0n);
    });

    it("allows withdraw after each booking independently", async function () {
      const { escrow, owner, customer, driver } = await loadFixture(deployEscrowFixture);

      await escrow.connect(customer).createBooking(1, driver.address, { value: ethers.parseEther("1.0") });
      await escrow.connect(owner).releasePayment(1);

      await escrow.connect(customer).createBooking(2, driver.address, { value: ethers.parseEther("2.0") });
      await escrow.connect(owner).releasePayment(2);

      // Both funds should be withdrawable
      const pending = await escrow.pendingWithdrawals(driver.address);
      expect(pending).to.equal(ethers.parseEther("3.0"));

      const balanceBefore = await ethers.provider.getBalance(driver.address);
      await escrow.connect(driver).withdraw();
      const balanceAfter = await ethers.provider.getBalance(driver.address);
      expect(balanceAfter).to.be.gt(balanceBefore);
    });
  });
});