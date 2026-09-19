import hre from "hardhat";
const { ethers } = hre;
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

async function signCommitment(owner, escrow, customer, bookingId, driver, amount, nonce) {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const commitment = ethers.solidityPackedKeccak256(
    ["uint256", "address", "address", "uint256", "address", "uint256", "uint256"],
    [chainId, await escrow.getAddress(), customer.address, bookingId, driver, amount, nonce]
  );
  return owner.signMessage(ethers.getBytes(commitment));
}

describe("TruxifyEscrow releasePayment Idempotency", function () {
  async function deployWithStartedBookingFixture() {
    const [owner, customer, driver] = await ethers.getSigners();
    const TruxifyEscrow = await ethers.getContractFactory("TruxifyEscrow");
    const escrow = await TruxifyEscrow.deploy();

    const bookingId = 101n;
    const amount = ethers.parseEther("1.5");
    const signature = await signCommitment(owner, escrow, customer, bookingId, driver.address, amount, 0n);

    await escrow
      .connect(customer)
      .createBooking(bookingId, driver.address, signature, { value: amount });

    await escrow.connect(owner).markBookingStarted(bookingId);

    return { escrow, owner, customer, driver, bookingId, amount };
  }

  it("releases payment with idempotency key and records the key", async function () {
    const { escrow, owner, driver, bookingId, amount } = await loadFixture(deployWithStartedBookingFixture);
    const idempotencyKey = ethers.keccak256(ethers.toUtf8Bytes("order-101:otp-hash-123456"));

    expect(await escrow.releaseIdempotencyKeys(idempotencyKey)).to.equal(false);

    await expect(escrow.connect(owner)["releasePayment(uint256,bytes32)"](bookingId, idempotencyKey))
      .to.emit(escrow, "PaymentReleased")
      .withArgs(bookingId, driver.address, amount);

    expect(await escrow.releaseIdempotencyKeys(idempotencyKey)).to.equal(true);
    const booking = await escrow.bookings(bookingId);
    expect(booking.paid).to.equal(true);
    expect(booking.amount).to.equal(0n);
    expect(await escrow.pendingWithdrawals(driver.address)).to.equal(amount);
  });

  it("reverts if the same idempotency key is replayed", async function () {
    const { escrow, owner, bookingId } = await loadFixture(deployWithStartedBookingFixture);
    const idempotencyKey = ethers.keccak256(ethers.toUtf8Bytes("order-101:otp-hash-123456"));

    await escrow.connect(owner)["releasePayment(uint256,bytes32)"](bookingId, idempotencyKey);

    await expect(
      escrow.connect(owner)["releasePayment(uint256,bytes32)"](bookingId, idempotencyKey)
    ).to.be.revertedWith("TruxifyEscrow: Idempotency key already used");
  });

  it("reverts with Already paid if attempting to release already paid booking with different key", async function () {
    const { escrow, owner, bookingId } = await loadFixture(deployWithStartedBookingFixture);
    const key1 = ethers.keccak256(ethers.toUtf8Bytes("order-101:otp-key-1"));
    const key2 = ethers.keccak256(ethers.toUtf8Bytes("order-101:otp-key-2"));

    await escrow.connect(owner)["releasePayment(uint256,bytes32)"](bookingId, key1);

    await expect(
      escrow.connect(owner)["releasePayment(uint256,bytes32)"](bookingId, key2)
    ).to.be.revertedWith("TruxifyEscrow: Already paid");
  });

  it("preserves backward compatibility for releasePayment(uint256)", async function () {
    const { escrow, owner, driver, bookingId, amount } = await loadFixture(deployWithStartedBookingFixture);

    await expect(escrow.connect(owner)["releasePayment(uint256)"](bookingId))
      .to.emit(escrow, "PaymentReleased")
      .withArgs(bookingId, driver.address, amount);

    const booking = await escrow.bookings(bookingId);
    expect(booking.paid).to.equal(true);

    await expect(
      escrow.connect(owner)["releasePayment(uint256)"](bookingId)
    ).to.be.revertedWith("TruxifyEscrow: Already paid");
  });
});
