const assert = require("node:assert/strict");
const { ethers } = require("hardhat");

async function assertRejectsWith(promise, message) {
  await assert.rejects(promise, (error) => error.message.includes(message));
}

describe("zkEVMBridge", function () {
  async function deployBridge() {
    const [owner, user, attacker] = await ethers.getSigners();
    const MockZkEVM = await ethers.getContractFactory("MockZkEVM");
    const zkEVM = await MockZkEVM.deploy();
    await zkEVM.waitForDeployment();
    const Bridge = await ethers.getContractFactory("zkEVMBridge");
    const bridge = await Bridge.deploy(await zkEVM.getAddress());
    await bridge.waitForDeployment();
    return { bridge, zkEVM, owner, user, attacker };
  }

  it("rejects any withdrawal attempt by a caller with no deposit", async function () {
    const { bridge, attacker } = await deployBridge();
    const proof = ethers.randomBytes(65);
    await assertRejectsWith(
      bridge.connect(attacker).withdrawFromL2(ethers.parseEther("0.01"), proof),
      "Exceeds deposited amount"
    );
  });

  it("rejects withdrawals larger than the caller's deposited amount", async function () {
    const { bridge, zkEVM, user } = await deployBridge();
    await bridge.connect(user).depositToL2({ value: ethers.parseEther("1") });
    const proof = ethers.randomBytes(65);
    await assertRejectsWith(
      bridge.connect(user).withdrawFromL2(ethers.parseEther("1.1"), proof),
      "Exceeds deposited amount"
    );
  });

  it("rejects a zero-amount withdrawal", async function () {
    const { bridge, zkEVM, user } = await deployBridge();
    await bridge.connect(user).depositToL2({ value: ethers.parseEther("1") });
    await assertRejectsWith(
      bridge.connect(user).withdrawFromL2(0, ethers.randomBytes(65)),
      "Amount must be > 0"
    );
  });

  it("rejects an empty proof", async function () {
    const { bridge, user } = await deployBridge();
    await bridge.connect(user).depositToL2({ value: ethers.parseEther("1") });
    await assertRejectsWith(
      bridge.connect(user).withdrawFromL2(ethers.parseEther("0.5"), "0x"),
      "Empty proof"
    );
  });

  it("credits and debits the per-user deposited amount", async function () {
    const { bridge, user } = await deployBridge();
    const fee = await bridge.bridgeFee();
    await bridge.connect(user).depositToL2({ value: ethers.parseEther("1") });
    assert.equal(
      await bridge.depositedAmount(user.address),
      ethers.parseEther("1") - fee
    );

    await bridge.connect(user).withdrawFromL2(ethers.parseEther("0.3"), ethers.randomBytes(65));
    assert.equal(
      await bridge.depositedAmount(user.address),
      ethers.parseEther("1") - fee - ethers.parseEther("0.3")
    );
  });

  it("queues withdrawals into pendingWithdrawals for later claim", async function () {
    const { bridge, user } = await deployBridge();
    await bridge.connect(user).depositToL2({ value: ethers.parseEther("1") });

    await bridge.connect(user).withdrawFromL2(ethers.parseEther("0.25"), ethers.randomBytes(65));
    assert.equal(await bridge.pendingWithdrawals(user.address), ethers.parseEther("0.25"));

    await bridge.connect(user).claimWithdrawal();
    assert.equal(await bridge.pendingWithdrawals(user.address), 0n);
  });

  it("prevents replaying the same proof twice", async function () {
    const { bridge, user } = await deployBridge();
    await bridge.connect(user).depositToL2({ value: ethers.parseEther("2") });
    const proof = ethers.randomBytes(65);

    await bridge.connect(user).withdrawFromL2(ethers.parseEther("0.5"), proof);
    assert.equal(await bridge.usedProofs(ethers.keccak256(proof)), true);

    await assertRejectsWith(
      bridge.connect(user).withdrawFromL2(ethers.parseEther("0.5"), proof),
      "Proof already used"
    );
  });

  it("only allows the owner to update the bridge fee", async function () {
    const { bridge, user } = await deployBridge();
    await assertRejectsWith(
      bridge.connect(user).setBridgeFee(ethers.parseEther("0.002")),
      "OwnableUnauthorizedAccount"
    );
    await bridge.setBridgeFee(ethers.parseEther("0.002"));
    assert.equal(await bridge.bridgeFee(), ethers.parseEther("0.002"));
  });

  it("only allows the owner to sweep accumulated fees", async function () {
    const { bridge, user, owner } = await deployBridge();
    await assertRejectsWith(
      bridge.connect(user).withdrawFees(),
      "OwnableUnauthorizedAccount"
    );

    await bridge.connect(user).depositToL2({ value: ethers.parseEther("1") });
    const ownerBefore = await ethers.provider.getBalance(owner.address);
    await bridge.connect(owner).withdrawFees();
    const ownerAfter = await ethers.provider.getBalance(owner.address);
    assert.ok(ownerAfter > ownerBefore, "owner balance should increase");
  });
});
