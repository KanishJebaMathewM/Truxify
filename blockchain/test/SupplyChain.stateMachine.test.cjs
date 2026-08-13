const assert = require("node:assert/strict");
const { ethers } = require("hardhat");

async function assertRejectsWith(promise, message) {
  await assert.rejects(promise, (error) => error.message.includes(message));
}

describe("SupplyChain state machine & verification", function () {
  async function deploy() {
    const [owner, sender, receiver, verifier, stranger] = await ethers.getSigners();
    const SupplyChain = await ethers.getContractFactory("SupplyChain");
    const sc = await SupplyChain.deploy();
    await sc.waitForDeployment();

    await sc.connect(sender).createProduct("Cargo", "desc", "cat", "ipfs://x", ethers.ZeroHash);
    await sc.connect(sender).createShipment(1n, receiver.address, "W1");

    return { sc, owner, sender, receiver, verifier, stranger, shipmentId: 1n };
  }

  it("starts as CREATED with a one-entry history", async function () {
    const { sc, shipmentId } = await deploy();
    const shipment = await sc.getShipment(shipmentId);
    assert.equal(shipment.status, "CREATED");
    const history = await sc.getShipmentStatusHistory(shipmentId);
    assert.equal(history.length, 1);
    assert.equal(history[0], 0n); // Created
  });

  it("advances forward one step at a time to DELIVERED", async function () {
    const { sc, shipmentId } = await deploy();
    await sc.updateShipmentStatus(shipmentId, "IN_TRANSIT", "ROUTE A");
    await sc.updateShipmentStatus(shipmentId, "ARRIVED", "W2");
    await sc.updateShipmentStatus(shipmentId, "DELIVERED", "W2");

    const shipment = await sc.getShipment(shipmentId);
    assert.equal(shipment.status, "DELIVERED");
    assert.ok(shipment.receivedAt > 0n);
    assert.ok(shipment.updatedAt > 0n);

    const history = await sc.getShipmentStatusHistory(shipmentId);
    assert.equal(history.length, 4);
    assert.equal(history[0], 0n); // Created
    assert.equal(history[1], 1n); // InTransit
    assert.equal(history[2], 2n); // Arrived
    assert.equal(history[3], 3n); // Delivered
  });

  it("rejects skipped transitions", async function () {
    const { sc, shipmentId } = await deploy();
    await assertRejectsWith(
      sc.updateShipmentStatus(shipmentId, "DELIVERED", "W2"),
      "Invalid transition"
    );
  });

  it("rejects backwards transitions", async function () {
    const { sc, shipmentId } = await deploy();
    await sc.updateShipmentStatus(shipmentId, "IN_TRANSIT", "ROUTE A");
    await assertRejectsWith(
      sc.updateShipmentStatus(shipmentId, "CREATED", "W1"),
      "Invalid transition"
    );
  });

  it("cancels only from CREATED", async function () {
    const { sc, shipmentId } = await deploy();
    await sc.updateShipmentStatus(shipmentId, "CANCELLED", "W1");
    assert.equal((await sc.getShipment(shipmentId)).status, "CANCELLED");
  });

  it("rejects cancelling a shipment that has left CREATED", async function () {
    const { sc, shipmentId } = await deploy();
    await sc.updateShipmentStatus(shipmentId, "IN_TRANSIT", "ROUTE A");
    await assertRejectsWith(
      sc.updateShipmentStatus(shipmentId, "CANCELLED", "W1"),
      "Invalid transition"
    );
  });

  it("treats DELIVERED as terminal", async function () {
    const { sc, shipmentId } = await deploy();
    await sc.updateShipmentStatus(shipmentId, "IN_TRANSIT", "ROUTE A");
    await sc.updateShipmentStatus(shipmentId, "ARRIVED", "W2");
    await sc.updateShipmentStatus(shipmentId, "DELIVERED", "W2");
    await assertRejectsWith(
      sc.updateShipmentStatus(shipmentId, "CANCELLED", "W1"),
      "Invalid transition"
    );
  });

  it("rejects unknown status strings", async function () {
    const { sc, shipmentId } = await deploy();
    await assertRejectsWith(
      sc.updateShipmentStatus(shipmentId, "INSPECTED", "W1"),
      "Invalid status"
    );
  });

  it("only allows the sender, receiver or owner to update status", async function () {
    const { sc, stranger, shipmentId } = await deploy();
    await assertRejectsWith(
      sc.connect(stranger).updateShipmentStatus(shipmentId, "IN_TRANSIT", "ROUTE A"),
      "Not authorized"
    );
  });

  it("registers verifiers only via the owner", async function () {
    const { sc, verifier, stranger } = await deploy();
    await assertRejectsWith(
      sc.connect(stranger).setVerifier(verifier.address, true),
      "OwnableUnauthorizedAccount"
    );
    await sc.setVerifier(verifier.address, true);
    assert.equal(await sc.verifiers(verifier.address), true);
  });

  it("rejects verification by a party without the verifier role", async function () {
    const { sc, stranger, shipmentId } = await deploy();
    await assertRejectsWith(
      sc.connect(stranger).verifyShipment(shipmentId),
      "Not an authorized verifier"
    );
  });

  it("rejects self-verification by the sender or receiver", async function () {
    const { sc, sender, receiver, shipmentId } = await deploy();
    await sc.setVerifier(sender.address, true);
    await sc.setVerifier(receiver.address, true);
    await assertRejectsWith(
      sc.connect(sender).verifyShipment(shipmentId),
      "Self verification not allowed"
    );
    await assertRejectsWith(
      sc.connect(receiver).verifyShipment(shipmentId),
      "Self verification not allowed"
    );
  });

  it("records an independent verifier immutably", async function () {
    const { sc, verifier, shipmentId } = await deploy();
    await sc.setVerifier(verifier.address, true);
    await sc.connect(verifier).verifyShipment(shipmentId);

    const shipment = await sc.getShipment(shipmentId);
    assert.equal(shipment.verifiedBy, verifier.address);
    assert.ok(shipment.verifiedAt > 0n);
  });
});
