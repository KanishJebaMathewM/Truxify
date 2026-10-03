const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AtomicSwap openSwap lockDuration bounds", function () {
  const amount = ethers.parseEther("1");
  const preimage = ethers.toUtf8Bytes("atomic-swap-secret");
  const hashLock = ethers.keccak256(preimage);

  async function deploySwap() {
    const [sender, recipient] = await ethers.getSigners();
    const AtomicSwap = await ethers.getContractFactory("AtomicSwap");
    const swap = await AtomicSwap.deploy();
    await swap.waitForDeployment();
    return { swap, sender, recipient };
  }

  function swapId(label) {
    return ethers.id(label);
  }

  it("rejects a zero lockDuration", async function () {
    const { swap, sender, recipient } = await deploySwap();

    await expect(
      swap.connect(sender).openSwap(swapId("zero"), recipient.address, hashLock, 0, { value: amount })
    ).to.be.revertedWith("Lock duration too short");
  });

  it("rejects a lockDuration just below the minimum", async function () {
    const { swap, sender, recipient } = await deploySwap();
    const min = await swap.MIN_LOCK_DURATION();

    await expect(
      swap.connect(sender).openSwap(swapId("below-min"), recipient.address, hashLock, min - 1n, { value: amount })
    ).to.be.revertedWith("Lock duration too short");
  });

  it("rejects a lockDuration above the maximum", async function () {
    const { swap, sender, recipient } = await deploySwap();
    const max = await swap.MAX_LOCK_DURATION();

    await expect(
      swap.connect(sender).openSwap(swapId("above-max"), recipient.address, hashLock, max + 1n, { value: amount })
    ).to.be.revertedWith("Lock duration too long");
  });

  it("does not consume the hash lock when the lockDuration is rejected", async function () {
    const { swap, sender, recipient } = await deploySwap();

    await expect(
      swap.connect(sender).openSwap(swapId("rejected"), recipient.address, hashLock, 0, { value: amount })
    ).to.be.revertedWith("Lock duration too short");

    expect(await swap.usedHashLocks(hashLock)).to.equal(false);
  });

  it("accepts the minimum and maximum lockDuration", async function () {
    const { swap, sender, recipient } = await deploySwap();
    const min = await swap.MIN_LOCK_DURATION();
    const max = await swap.MAX_LOCK_DURATION();

    await expect(
      swap.connect(sender).openSwap(swapId("at-min"), recipient.address, hashLock, min, { value: amount })
    ).to.emit(swap, "SwapOpened");

    const otherHashLock = ethers.keccak256(ethers.toUtf8Bytes("other-secret"));
    await expect(
      swap.connect(sender).openSwap(swapId("at-max"), recipient.address, otherHashLock, max, { value: amount })
    ).to.emit(swap, "SwapOpened");
  });

  it("blocks an immediate refund so the recipient can still claim", async function () {
    const { swap, sender, recipient } = await deploySwap();
    const min = await swap.MIN_LOCK_DURATION();
    const id = swapId("claim-window");

    await swap.connect(sender).openSwap(id, recipient.address, hashLock, min, { value: amount });

    await expect(swap.connect(sender).refundSwap(id)).to.be.revertedWith("Lock time not expired");

    await expect(swap.connect(recipient).claimSwap(id, preimage)).to.changeEtherBalance(recipient, amount);
  });

  it("allows the sender to refund once the minimum lock has expired", async function () {
    const { swap, sender, recipient } = await deploySwap();
    const min = await swap.MIN_LOCK_DURATION();
    const id = swapId("refund-after-expiry");

    await swap.connect(sender).openSwap(id, recipient.address, hashLock, min, { value: amount });
    await time.increase(min);

    await expect(swap.connect(sender).refundSwap(id)).to.emit(swap, "SwapRefunded").withArgs(id);
  });
});
