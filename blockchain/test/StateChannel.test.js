import assert from "node:assert/strict";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
const { ethers } = hre;

async function assertRejectsWith(promise, message) {
  await assert.rejects(promise, error => error.message.includes(message));
}

async function signState(signer, channelId, balanceA, balanceB, nonce) {
  const stateHash = ethers.solidityPackedKeccak256(
    ["uint256", "uint256", "uint256", "uint256"],
    [channelId, balanceA, balanceB, nonce]
  );
  return signer.signMessage(ethers.getBytes(stateHash));
}

function encodeDisputeProof(balanceA, balanceB, nonce, sigA, sigB) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "uint256", "uint256", "bytes", "bytes"],
    [balanceA, balanceB, nonce, sigA, sigB]
  );
}

const CHALLENGE_PERIOD = 24 * 60 * 60;
const SETTLEMENT_PERIOD = 7 * 24 * 60 * 60;

describe("StateChannel.resolveDispute", function () {
  async function deployFundedChannel() {
    const [owner, partyA, partyB, outsider] = await ethers.getSigners();
    const StateChannel = await ethers.getContractFactory("StateChannel");
    const channel = await StateChannel.deploy();
    await channel.waitForDeployment();

    await channel.connect(partyA).openChannel(partyB.address);
    const channelId = 1n;

    await channel.connect(partyA).fundChannel(channelId, { value: ethers.parseEther("5") });
    await channel.connect(partyB).fundChannel(channelId, { value: ethers.parseEther("5") });

    return { channel, owner, partyA, partyB, outsider, channelId };
  }

  it("rejects a dispute resolved with only the challenger's self-signed proof", async function () {
    const { channel, owner, partyA, partyB, channelId } = await deployFundedChannel();
    const total = ethers.parseEther("10");

    // partyA raises a dispute and tries to win the entire channel balance
    // using a state that only they signed (old vulnerability).
    await channel.connect(partyA).raiseDispute(channelId, ethers.ZeroHash);

    const forgedSig = await signState(partyA, channelId, total, 0n, 1n);
    const proof = encodeDisputeProof(total, 0n, 1n, forgedSig, forgedSig);

    await time.increase(SETTLEMENT_PERIOD + 1);

    await assertRejectsWith(
      channel.connect(owner).resolveDispute(channelId, proof),
      "Invalid signature"
    );
  });

  it("resolves a dispute only when both participants signed the disputed state", async function () {
    const { channel, owner, partyA, partyB, channelId } = await deployFundedChannel();
    const newBalanceA = ethers.parseEther("8");
    const newBalanceB = ethers.parseEther("2");

    await channel.connect(partyB).raiseDispute(channelId, ethers.ZeroHash);

    const sigA = await signState(partyA, channelId, newBalanceA, newBalanceB, 1n);
    const sigB = await signState(partyB, channelId, newBalanceA, newBalanceB, 1n);
    const proof = encodeDisputeProof(newBalanceA, newBalanceB, 1n, sigA, sigB);

    await time.increase(SETTLEMENT_PERIOD + 1);

    await channel.connect(owner).resolveDispute(channelId, proof);

    await channel.connect(partyA).withdraw(channelId);
    await channel.connect(partyB).withdraw(channelId);

    const finalA = await ethers.provider.getBalance(await channel.getAddress());
    assert.equal(finalA, 0n);
  });

  it("rejects a disputed state whose nonce is older than the channel's last mutually-signed state", async function () {
    const { channel, owner, partyA, partyB, channelId } = await deployFundedChannel();
    const total = ethers.parseEther("10");

    // Both parties mutually agree on a later state (nonce 2) via updateState.
    const sigA2 = await signState(partyA, channelId, ethers.parseEther("6"), ethers.parseEther("4"), 2n);
    const sigB2 = await signState(partyB, channelId, ethers.parseEther("6"), ethers.parseEther("4"), 2n);
    await channel.connect(partyA).updateState(channelId, ethers.parseEther("6"), ethers.parseEther("4"), 2n, sigA2, sigB2);

    await channel.connect(partyA).raiseDispute(channelId, ethers.ZeroHash);

    // partyB tries to settle using an older mutually-signed state (nonce 1) to
    // claim more than they're currently entitled to.
    const sigA1 = await signState(partyA, channelId, 0n, total, 1n);
    const sigB1 = await signState(partyB, channelId, 0n, total, 1n);
    const staleProof = encodeDisputeProof(0n, total, 1n, sigA1, sigB1);

    await time.increase(SETTLEMENT_PERIOD + 1);

    await assertRejectsWith(
      channel.connect(owner).resolveDispute(channelId, staleProof),
      "Stale disputed state"
    );
  });
});