import { expect } from "chai";
import pkg from "hardhat";
const { ethers } = pkg;

describe("Truxify Escrow Contract", function () {
  let Escrow;
  let escrow;
  let owner;
  let customer;
  let driver;
  const bookingId = "BK_TEST_1001";
  const amount = ethers.parseEther("1.0");

  beforeEach(async function () {
    [owner, customer, driver] = await ethers.getSigners();
    Escrow = await ethers.getContractFactory("Escrow");
    escrow = await Escrow.deploy();
    await escrow.waitForDeployment();
  });

  it("should fund escrow correctly by customer", async function () {
    await expect(
      escrow.connect(customer).createEscrow(bookingId, driver.address, { value: amount })
    )
      .to.emit(escrow, "EscrowFunded")
      .withArgs(bookingId, customer.address, driver.address, amount);

    const order = await escrow.orders(bookingId);
    expect(order.customer).to.equal(customer.address);
    expect(order.driver).to.equal(driver.address);
    expect(order.amount).to.equal(amount);
    expect(order.isCompleted).to.equal(false);
    expect(order.isRefunded).to.equal(false);
  });

  it("should release escrow payment to driver upon valid confirmation", async function () {
    await escrow.connect(customer).createEscrow(bookingId, driver.address, { value: amount });

    const driverInitialBalance = await ethers.provider.getBalance(driver.address);

    await expect(escrow.connect(owner).confirmDeliveryAndRelease(bookingId))
      .to.emit(escrow, "PaymentReleased")
      .withArgs(bookingId, driver.address, amount);

    const driverFinalBalance = await ethers.provider.getBalance(driver.address);
    expect(driverFinalBalance - driverInitialBalance).to.equal(amount);

    const order = await escrow.orders(bookingId);
    expect(order.isCompleted).to.equal(true);
  });

  it("should cancel escrow and refund customer before driver completes delivery", async function () {
    await escrow.connect(customer).createEscrow(bookingId, driver.address, { value: amount });

    const customerInitialBalance = await ethers.provider.getBalance(customer.address);

    await expect(escrow.connect(owner).refundCustomer(bookingId))
      .to.emit(escrow, "CustomerRefunded")
      .withArgs(bookingId, customer.address, amount);

    const customerFinalBalance = await ethers.provider.getBalance(customer.address);
    expect(customerFinalBalance - customerInitialBalance).to.equal(amount);

    const order = await escrow.orders(bookingId);
    expect(order.isRefunded).to.equal(true);
  });

  it("should reject release if already completed or refunded", async function () {
    await escrow.connect(customer).createEscrow(bookingId, driver.address, { value: amount });
    await escrow.connect(owner).confirmDeliveryAndRelease(bookingId);

    await expect(
      escrow.connect(owner).confirmDeliveryAndRelease(bookingId)
    ).to.be.revertedWith("Order already completed or refunded");
  });
});
