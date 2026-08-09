const { expect } = require("chai");
const { ethers } = require("hardhat");

const AMOUNT = ethers.parseEther("1");
const DISPUTE_TIMEOUT_SECS = 7 * 24 * 3600;

// BookingStatus: Active=0, Delivered=1, Cancelled=2, Disputed=3, Resolved=4
const STATUS = { Active: 0, Delivered: 1, Cancelled: 2, Disputed: 3, Resolved: 4 };

/**
 * Mint the same EIP-191 commitment the contract verifies:
 *   keccak256(chainId, this, customer, bookingId, commitmentNonces[customer])
 */
async function signCommitment(signer, escrow, customer, bookingId) {
  const { chainId } = await ethers.provider.getNetwork();
  const nonce = await escrow.commitmentNonces(customer);
  const commitment = ethers.solidityPackedKeccak256(
    ["uint256", "address", "address", "uint256", "uint256"],
    [chainId, escrow.target, customer, bookingId, nonce]
  );
  return signer.signMessage(ethers.getBytes(commitment));
}

describe("TruxifyEscrow", function () {
  let escrow;
  let owner, customer, driver, attacker, otherCustomer;

  beforeEach(async function () {
    [owner, customer, driver, attacker, otherCustomer] = await ethers.getSigners();
    const Escrow = await ethers.getContractFactory("TruxifyEscrow");
    escrow = await Escrow.deploy();
  });

  describe("createBooking — owner-signed commitment (issue #7734)", function () {
    it("creates a booking with a valid owner-signed commitment", async function () {
      const bookingId = 1;
      const sig = await signCommitment(owner, escrow, customer.address, bookingId);

      await expect(
        escrow.connect(customer).createBooking(bookingId, driver.address, sig, { value: AMOUNT })
      )
        .to.emit(escrow, "BookingCreated")
        .withArgs(bookingId, customer.address, driver.address, AMOUNT);

      const booking = await escrow.bookings(bookingId);
      expect(booking.customer).to.equal(customer.address);
      expect(booking.driver).to.equal(driver.address);
      expect(booking.amount).to.equal(AMOUNT);
      expect(booking.status).to.equal(STATUS.Active);
      expect(booking.paid).to.equal(false);
    });

    it("reverts when the commitment is forged by a non-owner (front-running blocked)", async function () {
      const bookingId = 1;
      const forged = await signCommitment(attacker, escrow, customer.address, bookingId);

      await expect(
        escrow.connect(customer).createBooking(bookingId, driver.address, forged, { value: AMOUNT })
      ).to.be.revertedWith("TruxifyEscrow: Invalid commitment signature");

      expect((await escrow.bookings(bookingId)).customer).to.equal(ethers.ZeroAddress);
    });

    it("reverts for a malformed signature", async function () {
      await expect(
        escrow.connect(customer).createBooking(1, driver.address, "0x1234", { value: AMOUNT })
      ).to.be.revertedWith("TruxifyEscrow: Invalid signature length");
    });

    it("reverts when the commitment covers a different bookingId", async function () {
      const bookingId = 1;
      const sig = await signCommitment(owner, escrow, customer.address, 99);

      await expect(
        escrow.connect(customer).createBooking(bookingId, driver.address, sig, { value: AMOUNT })
      ).to.be.revertedWith("TruxifyEscrow: Invalid commitment signature");
    });

    it("reverts when the commitment covers a different customer wallet", async function () {
      const bookingId = 1;
      const sig = await signCommitment(owner, escrow, otherCustomer.address, bookingId);

      await expect(
        escrow.connect(customer).createBooking(bookingId, driver.address, sig, { value: AMOUNT })
      ).to.be.revertedWith("TruxifyEscrow: Invalid commitment signature");
    });

    it("burns the nonce — a replayed commitment reverts", async function () {
      const bookingId = 1;
      const sig = await signCommitment(owner, escrow, customer.address, bookingId);
      await escrow.connect(customer).createBooking(bookingId, driver.address, sig, { value: AMOUNT });

      await expect(
        escrow.connect(customer).createBooking(2, driver.address, sig, { value: AMOUNT })
      ).to.be.revertedWith("TruxifyEscrow: Invalid commitment signature");
    });

    it("records msg.sender as the customer so the wallet funds the escrow", async function () {
      const bookingId = 1;
      const sig = await signCommitment(owner, escrow, customer.address, bookingId);
      await escrow.connect(customer).createBooking(bookingId, driver.address, sig, { value: AMOUNT });

      const booking = await escrow.bookings(bookingId);
      expect(booking.customer).to.equal(customer.address);
      expect(booking.customer).not.to.equal(owner.address);
    });
  });

  describe("slot reuse after settlement (issue #7734)", function () {
    async function createBooking(bookingId, who = customer) {
      const sig = await signCommitment(owner, escrow, who.address, bookingId);
      await escrow.connect(who).createBooking(bookingId, driver.address, sig, { value: AMOUNT });
    }

    it("cannot re-create the slot while the original booking is active", async function () {
      await createBooking(1);
      const sig = await signCommitment(owner, escrow, customer.address, 1);

      await expect(
        escrow.connect(customer).createBooking(1, driver.address, sig, { value: AMOUNT })
      ).to.be.revertedWith("TruxifyEscrow: Booking already exists");
    });

    it("re-creates the booking after cancelBooking and the refund is withdrawable", async function () {
      await createBooking(1);
      await escrow.connect(owner).cancelBooking(1);
      expect((await escrow.bookings(1)).status).to.equal(STATUS.Cancelled);

      await escrow.connect(customer).withdraw();
      expect(await escrow.pendingWithdrawals(customer.address)).to.equal(0n);

      // Same bookingId can now be re-created (fresh commitment, nonce bumped).
      await createBooking(1);
      const booking = await escrow.bookings(1);
      expect(booking.customer).to.equal(customer.address);
      expect(booking.status).to.equal(STATUS.Active);
      expect(booking.amount).to.equal(AMOUNT);
    });

    it("re-creates the booking after cancelWithPenalty", async function () {
      await createBooking(1);
      await escrow.connect(owner).cancelWithPenalty(1, ethers.parseEther("0.2"));

      await createBooking(1);
      expect((await escrow.bookings(1)).customer).to.equal(customer.address);
      expect((await escrow.bookings(1)).status).to.equal(STATUS.Active);
    });

    it("re-creates the booking after resolveDisputeTimeout", async function () {
      await createBooking(1);
      await escrow.connect(owner).raiseDispute(1);
      await ethers.provider.send("evm_increaseTime", [DISPUTE_TIMEOUT_SECS + 1]);
      await ethers.provider.send("evm_mine", []);
      await escrow.connect(owner).resolveDisputeTimeout(1);
      expect((await escrow.bookings(1)).status).to.equal(STATUS.Cancelled);

      await createBooking(1);
      expect((await escrow.bookings(1)).customer).to.equal(customer.address);
      expect((await escrow.bookings(1)).status).to.equal(STATUS.Active);
    });

    it("does NOT free the slot after releasePayment (Delivered is terminal)", async function () {
      await createBooking(1);
      await escrow.connect(owner).releasePayment(1);
      expect((await escrow.bookings(1)).status).to.equal(STATUS.Delivered);

      const sig = await signCommitment(owner, escrow, customer.address, 1);
      await expect(
        escrow.connect(customer).createBooking(1, driver.address, sig, { value: AMOUNT })
      ).to.be.revertedWith("TruxifyEscrow: Booking already exists");
    });
  });
});
