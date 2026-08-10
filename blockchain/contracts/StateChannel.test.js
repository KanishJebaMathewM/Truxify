const { expect } = require("chai");
const { ethers } = require("hardhat");

const CHALLENGE_PERIOD = 24 * 60 * 60; // 1 day in seconds

function stateHash(channelId, sequence, balanceA, balanceB) {
  return ethers.solidityPackedKeccak256(
    ["bytes32", "uint256", "uint256", "uint256"],
    [channelId, sequence, balanceA, balanceB]
  );
}

async function signState(signer, channelId, sequence, balanceA, balanceB) {
  return signer.signMessage(ethers.getBytes(stateHash(channelId, sequence, balanceA, balanceB)));
}

async function deployChannel() {
  const StateChannel = await ethers.getContractFactory("StateChannel");
  const contract = await StateChannel.deploy();
  const [userA, userB, attacker] = await ethers.getSigners();
  return { contract, userA, userB, attacker };
}

async function openChannel(contract, userA, userB, deposit) {
  const tx = await contract.connect(userA).openChannel(userB.address, { value: deposit });
  const receipt = await tx.wait();
  const parsed = receipt.logs
    .map((l) => {
      try {
        return contract.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const open = parsed.find((e) => e.name === "ChannelOpened");
  return open.args.channelId;
}

async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

describe("StateChannel", function () {
  describe("openChannel", function () {
    it("reverts without a deposit", async function () {
      const { contract, userA, userB } = await deployChannel();
      await expect(contract.connect(userA).openChannel(userB.address)).to.be.revertedWith("Deposit required");
    });

    it("rejects a zero-address counterparty", async function () {
      const { contract, userA } = await deployChannel();
      await expect(
        contract.connect(userA).openChannel(ethers.ZeroAddress, { value: ethers.parseEther("1") })
      ).to.be.revertedWith("Invalid user B");
    });

    it("funds the channel and emits ChannelOpened", async function () {
      const { contract, userA, userB } = await deployChannel();
      const deposit = ethers.parseEther("2");
      const tx = await contract.connect(userA).openChannel(userB.address, { value: deposit });
      const receipt = await tx.wait();
      const parsed = receipt.logs
        .map((l) => {
          try {
            return contract.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      const open = parsed.find((e) => e.name === "ChannelOpened");
      const channel = await contract.channels(open.args.channelId);
      expect(channel.userA).to.equal(userA.address);
      expect(channel.userB).to.equal(userB.address);
      expect(channel.balanceA).to.equal(deposit);
      expect(channel.balanceB).to.equal(0n);
    });
  });

  describe("initiateUnilateralExit", function () {
    async function disputedChannel(balanceA, balanceB) {
      const { contract, userA, userB } = await deployChannel();
      const channelId = await openChannel(contract, userA, userB, ethers.parseEther("10"));
      const sigB = await signState(userB, channelId, 1, balanceA, balanceB);
      return { contract, userA, userB, channelId, sigB };
    }

    it("accepts a countersigned state with the correct balance sum", async function () {
      const { contract, userA, channelId, sigB } = await disputedChannel(ethers.parseEther("6"), ethers.parseEther("4"));
      const tx = await contract.connect(userA).initiateUnilateralExit(
        channelId,
        1,
        ethers.parseEther("6"),
        ethers.parseEther("4"),
        sigB
      );
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);
      await expect(tx)
        .to.emit(contract, "DisputeInitiated")
        .withArgs(channelId, 1, block.timestamp + CHALLENGE_PERIOD);

      const channel = await contract.channels(channelId);
      expect(channel.isDisputed).to.equal(true);
      expect(channel.sequence).to.equal(1n);
      expect(channel.balanceA).to.equal(ethers.parseEther("6"));
      expect(channel.balanceB).to.equal(ethers.parseEther("4"));
      expect(channel.challengeExpiry).to.equal(block.timestamp + CHALLENGE_PERIOD);
    });

    it("reverts when the state underpays the deposit sum", async function () {
      const { contract, userA, channelId, sigB } = await disputedChannel(ethers.parseEther("5"), ethers.parseEther("4"));
      await expect(
        contract.connect(userA).initiateUnilateralExit(
          channelId,
          1,
          ethers.parseEther("5"),
          ethers.parseEther("4"),
          sigB
        )
      ).to.be.revertedWith("Invalid balance sum");
    });

    it("reverts when the state overpays the deposit sum", async function () {
      const { contract, userA, channelId, sigB } = await disputedChannel(ethers.parseEther("7"), ethers.parseEther("4"));
      await expect(
        contract.connect(userA).initiateUnilateralExit(
          channelId,
          1,
          ethers.parseEther("7"),
          ethers.parseEther("4"),
          sigB
        )
      ).to.be.revertedWith("Invalid balance sum");
    });

    it("reverts with a stale sequence", async function () {
      const { contract, userA, userB } = await deployChannel();
      const channelId = await openChannel(contract, userA, userB, ethers.parseEther("10"));
      const sigB = await signState(userB, channelId, 1, ethers.parseEther("10"), 0n);
      await contract.connect(userA).initiateUnilateralExit(
        channelId,
        1,
        ethers.parseEther("10"),
        0n,
        sigB
      );
      // Replay the same countersigned sequence — rejected as stale after the
      // first exit advanced the sequence to 1.
      const staleSigB = await signState(userB, channelId, 0, ethers.parseEther("9"), ethers.parseEther("1"));
      await expect(
        contract.connect(userA).initiateUnilateralExit(
          channelId,
          0,
          ethers.parseEther("9"),
          ethers.parseEther("1"),
          staleSigB
        )
      ).to.be.revertedWith("Stale sequence");
    });

    it("reverts for a non-participant", async function () {
      const { contract, userA, userB, attacker } = await deployChannel();
      const channelId = await openChannel(contract, userA, userB, ethers.parseEther("10"));
      const sigA = await signState(userA, channelId, 1, ethers.parseEther("10"), 0n);
      await expect(
        contract.connect(attacker).initiateUnilateralExit(
          channelId,
          1,
          ethers.parseEther("10"),
          0n,
          sigA
        )
      ).to.be.revertedWith("Not participant");
    });

    it("reverts on a forged counterparty signature", async function () {
      const { contract, userA, userB, attacker } = await deployChannel();
      const channelId = await openChannel(contract, userA, userB, ethers.parseEther("10"));
      const forged = await signState(attacker, channelId, 1, ethers.parseEther("10"), 0n);
      await expect(
        contract.connect(userA).initiateUnilateralExit(
          channelId,
          1,
          ethers.parseEther("10"),
          0n,
          forged
        )
      ).to.be.revertedWith("Invalid signature from userB");
    });
  });

  describe("finalizeExit", function () {
    async function setupDispute({ balanceA, balanceB } = { balanceA: ethers.parseEther("6"), balanceB: ethers.parseEther("4") }) {
      const { contract, userA, userB } = await deployChannel();
      const channelId = await openChannel(contract, userA, userB, ethers.parseEther("10"));
      const sigB = await signState(userB, channelId, 1, balanceA, balanceB);
      await contract.connect(userA).initiateUnilateralExit(channelId, 1, balanceA, balanceB, sigB);
      return { contract, userA, userB, channelId };
    }

    it("reverts with no active dispute", async function () {
      const { contract, userA, userB } = await deployChannel();
      const channelId = await openChannel(contract, userA, userB, ethers.parseEther("10"));
      await expect(contract.connect(userA).finalizeExit(channelId)).to.be.revertedWith("No active dispute");
    });

    it("reverts while the challenge period is active", async function () {
      const { contract, userA, channelId } = await setupDispute();
      await expect(contract.connect(userA).finalizeExit(channelId)).to.be.revertedWith("Challenge period active");
    });

    it("pays out the full deposit and closes the channel after the challenge period", async function () {
      const { contract, userA, userB, channelId } = await setupDispute();
      await increaseTime(CHALLENGE_PERIOD);

      const balanceBBefore = await ethers.provider.getBalance(userB.address);

      await expect(contract.connect(userA).finalizeExit(channelId))
        .to.emit(contract, "ChannelClosed")
        .withArgs(channelId, ethers.parseEther("6"), ethers.parseEther("4"));

      // userB pays no gas, so the exact amount is verifiable.
      expect(await ethers.provider.getBalance(userB.address)).to.equal(
        balanceBBefore + ethers.parseEther("4")
      );
      expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(0n);
      expect((await contract.channels(channelId)).isClosed).to.equal(true);
    });

    it("reverts after the channel is already closed", async function () {
      const { contract, userA, channelId } = await setupDispute();
      await increaseTime(CHALLENGE_PERIOD);
      await contract.connect(userA).finalizeExit(channelId);
      await expect(contract.connect(userA).finalizeExit(channelId)).to.be.revertedWith("Already closed");
    });
  });

  describe("cooperativeClose", function () {
    it("enforces the balance-sum invariant", async function () {
      const { contract, userA, userB } = await deployChannel();
      const channelId = await openChannel(contract, userA, userB, ethers.parseEther("10"));
      const sigA = await signState(userA, channelId, 1, ethers.parseEther("9"), ethers.parseEther("2"));
      const sigB = await signState(userB, channelId, 1, ethers.parseEther("9"), ethers.parseEther("2"));
      await expect(
        contract.connect(userA).cooperativeClose(
          channelId,
          ethers.parseEther("9"),
          ethers.parseEther("2"),
          sigA,
          sigB
        )
      ).to.be.revertedWith("Invalid balance sum");
    });

    it("closes and pays out both parties on a valid sum", async function () {
      const { contract, userA, userB } = await deployChannel();
      const channelId = await openChannel(contract, userA, userB, ethers.parseEther("10"));
      const sigA = await signState(userA, channelId, 1, ethers.parseEther("7"), ethers.parseEther("3"));
      const sigB = await signState(userB, channelId, 1, ethers.parseEther("7"), ethers.parseEther("3"));

      await expect(
        contract.connect(userA).cooperativeClose(
          channelId,
          ethers.parseEther("7"),
          ethers.parseEther("3"),
          sigA,
          sigB
        )
      ).to.emit(contract, "ChannelClosed")
        .withArgs(channelId, ethers.parseEther("7"), ethers.parseEther("3"));

      expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(0n);
      expect((await contract.channels(channelId)).isClosed).to.equal(true);
    });
  });
});
