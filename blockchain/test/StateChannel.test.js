import assert from "node:assert/strict";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
const { ethers } = hre;

async function assertRejectsWith(promise, message) {
  await assert.rejects(promise, error => error.message.includes(message));
}

const CHALLENGE_PERIOD = 24 * 60 * 60;

async function deployChannel(total = ethers.parseEther("10")) {
  const [owner, partyA, partyB] = await ethers.getSigners();
  const StateChannel = await ethers.getContractFactory("StateChannel");
  const channel = await StateChannel.deploy();
  await channel.waitForDeployment();

  const openTx = await channel.connect(partyA).openChannel(partyB.address, { value: total });
  const openReceipt = await openTx.wait();
  const channelId = channel.interface.parseLog(openReceipt.logs[0]).args.channelId;

  return { channel, owner, partyA, partyB, channelId, total };
}

async function signState(signer, channelId, balanceA, balanceB, sequence) {
  const stateHash = ethers.solidityPackedKeccak256(
    ["bytes32", "uint256", "uint256", "uint256"],
    [channelId, sequence, balanceA, balanceB]
  );
  return signer.signMessage(ethers.getBytes(stateHash));
}

describe("StateChannel", function () {
  describe("openChannel", function () {
    it("registers a funded channel between both participants", async function () {
      const { channel, partyA, partyB, channelId, total } = await deployChannel();

      const stored = await channel.channels(channelId);
      assert.equal(stored.userA, partyA.address);
      assert.equal(stored.userB, partyB.address);
      assert.equal(stored.balanceA, total);
      assert.equal(stored.balanceB, 0n);
      assert.equal(stored.isDisputed, false);
    });
  });

  describe("cooperativeClose", function () {
    it("splits the channel balance and closes it", async function () {
      const { channel, partyA, partyB, channelId, total } = await deployChannel();
      const shareA = total / 2n;
      const shareB = total - shareA;

      const sigA = await signState(partyA, channelId, shareA, shareB, 1n);
      const sigB = await signState(partyB, channelId, shareA, shareB, 1n);

      await channel.connect(partyA).cooperativeClose(channelId, shareA, shareB, sigA, sigB);

      const closed = await channel.channels(channelId);
      assert.equal(closed.isClosed, true);
      assert.equal(await ethers.provider.getBalance(await channel.getAddress()), 0n);
    });

    it("rejects a close with an invalid balance sum", async function () {
      const { channel, partyA, partyB, channelId, total } = await deployChannel();
      const sigA = await signState(partyA, channelId, total, total, 1n);
      const sigB = await signState(partyB, channelId, total, total, 1n);

      await assertRejectsWith(
        channel.connect(partyA).cooperativeClose(channelId, total, total, sigA, sigB),
        "Invalid balance sum"
      );
    });
  });

  describe("initiateUnilateralExit", function () {
    it("starts a dispute when the counterparty signs the state", async function () {
      const { channel, partyA, partyB, channelId, total } = await deployChannel();
      const balanceA = (total * 6n) / 10n;
      const balanceB = total - balanceA;

      const sigB = await signState(partyB, channelId, balanceA, balanceB, 1n);
      await channel
        .connect(partyA)
        .initiateUnilateralExit(channelId, 1n, balanceA, balanceB, sigB);

      const stored = await channel.channels(channelId);
      assert.equal(stored.isDisputed, true);
      assert.equal(stored.balanceA, balanceA);
      assert.equal(stored.sequence, 1n);
      assert.ok(stored.challengeExpiry > 0n);
    });

    it("rejects a state signed by the wrong counterparty", async function () {
      const { channel, partyA, partyB, channelId, total } = await deployChannel();
      const balanceA = (total * 6n) / 10n;
      const balanceB = total - balanceA;

      // partyA signs their own claim; only userB's signature is accepted.
      const sigA = await signState(partyA, channelId, balanceA, balanceB, 1n);
      await assertRejectsWith(
        channel.connect(partyA).initiateUnilateralExit(channelId, 1n, balanceA, balanceB, sigA),
        "Invalid signature"
      );
    });

    it("rejects re-submitting the same signed state (issue #10792)", async function () {
      const { channel, partyA, partyB, channelId, total } = await deployChannel();
      const balanceA = (total * 6n) / 10n;
      const balanceB = total - balanceA;

      const sigB = await signState(partyB, channelId, balanceA, balanceB, 1n);
      await channel.connect(partyA).initiateUnilateralExit(channelId, 1n, balanceA, balanceB, sigB);

      // Re-posting the same already-signed state must be rejected so it cannot
      // reset challengeExpiry and lock the channel forever.
      await assertRejectsWith(
        channel.connect(partyA).initiateUnilateralExit(channelId, 1n, balanceA, balanceB, sigB),
        "Stale sequence"
      );
    });

    it("does not extend challengeExpiry when a newer state is submitted mid-dispute (issue #10792)", async function () {
      const { channel, partyA, partyB, channelId, total } = await deployChannel();

      const sigB1 = await signState(partyB, channelId, (total * 6n) / 10n, (total * 4n) / 10n, 1n);
      await channel
        .connect(partyA)
        .initiateUnilateralExit(channelId, 1n, (total * 6n) / 10n, (total * 4n) / 10n, sigB1);
      const expiryAfterFirst = (await channel.channels(channelId)).challengeExpiry;

      const sigB2 = await signState(partyB, channelId, (total * 7n) / 10n, (total * 3n) / 10n, 2n);
      await channel
        .connect(partyA)
        .initiateUnilateralExit(channelId, 2n, (total * 7n) / 10n, (total * 3n) / 10n, sigB2);

      const afterSecond = await channel.channels(channelId);
      assert.equal(
        afterSecond.challengeExpiry,
        expiryAfterFirst,
        "Submitting a newer state must not extend the challenge window"
      );
      assert.equal(afterSecond.balanceA, (total * 7n) / 10n);
      assert.equal(afterSecond.balanceB, (total * 3n) / 10n);
    });
  });

  describe("finalizeExit", function () {
    it("rejects finalization while the challenge period is active", async function () {
      const { channel, owner, partyA, partyB, channelId, total } = await deployChannel();
      const sigB = await signState(partyB, channelId, (total * 6n) / 10n, (total * 4n) / 10n, 1n);
      await channel.connect(partyA).initiateUnilateralExit(channelId, 1n, (total * 6n) / 10n, (total * 4n) / 10n, sigB);

      await assertRejectsWith(channel.connect(owner).finalizeExit(channelId), "Challenge period active");
    });

    it("pays out the disputed balances once the challenge period elapses (issue #10792)", async function () {
      const { channel, owner, partyA, partyB, channelId, total } = await deployChannel();
      const balanceA = (total * 6n) / 10n;
      const balanceB = total - balanceA;

      const sigB = await signState(partyB, channelId, balanceA, balanceB, 1n);
      await channel.connect(partyA).initiateUnilateralExit(channelId, 1n, balanceA, balanceB, sigB);

      // The same-state re-submission attack must not be able to extend expiry.
      await assertRejectsWith(
        channel.connect(partyA).initiateUnilateralExit(channelId, 1n, balanceA, balanceB, sigB),
        "Stale sequence"
      );

      await time.increase(CHALLENGE_PERIOD + 1);
      await channel.connect(owner).finalizeExit(channelId);

      const closed = await channel.channels(channelId);
      assert.equal(closed.isClosed, true);
      assert.equal(await ethers.provider.getBalance(await channel.getAddress()), 0n);
    });
  });
});
