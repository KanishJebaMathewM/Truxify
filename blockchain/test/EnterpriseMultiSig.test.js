const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("EnterpriseMultiSig", function () {
  let multiSig;
  let owner1, owner2, owner3, nonOwner, receiver;
  const NUM_CONFIRMATIONS_REQUIRED = 2;
  const TIMELOCK_DELAY = 2 * 24 * 60 * 60; // 2 days

  beforeEach(async function () {
    [owner1, owner2, owner3, nonOwner, receiver] = await ethers.getSigners();
    const owners = [owner1.address, owner2.address, owner3.address];

    const EnterpriseMultiSig = await ethers.getContractFactory("EnterpriseMultiSig");
    multiSig = await EnterpriseMultiSig.deploy(owners, NUM_CONFIRMATIONS_REQUIRED);
    await multiSig.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct owners and required confirmations", async function () {
      expect(await multiSig.requiredConfirmations()).to.equal(NUM_CONFIRMATIONS_REQUIRED);
      expect(await multiSig.owners(0)).to.equal(owner1.address);
      expect(await multiSig.isOwner(owner1.address)).to.equal(true);
      expect(await multiSig.isOwner(nonOwner.address)).to.equal(false);
    });

    it("Should fail if confirmations exceed owners", async function () {
      const EnterpriseMultiSig = await ethers.getContractFactory("EnterpriseMultiSig");
      await expect(
        EnterpriseMultiSig.deploy([owner1.address], 2)
      ).to.be.revertedWith("Invalid confirmation count");
    });

    it("Should fail with zero owners or duplicate owners", async function () {
      const EnterpriseMultiSig = await ethers.getContractFactory("EnterpriseMultiSig");
      await expect(
        EnterpriseMultiSig.deploy([], 1)
      ).to.be.revertedWith("Owners required");
      await expect(
        EnterpriseMultiSig.deploy([owner1.address, owner1.address], 1)
      ).to.be.revertedWith("Owner not unique");
    });
  });

  describe("Transactions", function () {
    it("Should allow an owner to propose a transaction (auto-confirmed by proposer)", async function () {
      await expect(
        multiSig.connect(owner1).proposeTransaction(receiver.address, 100, "0x")
      ).to.emit(multiSig, "TransactionProposed");

      const tx = await multiSig.transactions(0);
      expect(tx.destination).to.equal(receiver.address);
      expect(tx.value).to.equal(100);
      expect(tx.executed).to.equal(false);
      expect(tx.confirmations).to.equal(1); // proposer auto-confirms
      expect(await multiSig.isConfirmed(0, owner1.address)).to.equal(true);
    });

    it("Should not allow non-owner to propose a transaction", async function () {
      await expect(
        multiSig.connect(nonOwner).proposeTransaction(receiver.address, 100, "0x")
      ).to.be.revertedWith("Not an owner");
    });
  });

  describe("Confirm and Execute", function () {
    let target; // DocumentRegistry whose owner is the multisig

    beforeEach(async function () {
      // The multisig has no receive/fallback, so execute a valueless
      // governance call instead: a DocumentRegistry owned by the multisig.
      const DocumentRegistry = await ethers.getContractFactory("DocumentRegistry");
      target = await DocumentRegistry.deploy();
      await target.waitForDeployment();
      await target.transferOwnership(await multiSig.getAddress());

      const data = target.interface.encodeFunctionData("registerDocument", [
        receiver.address,
        "RC_BOOK",
        ethers.id("doc-1"),
        true,
      ]);
      await multiSig.connect(owner1).proposeTransaction(await target.getAddress(), 0, data);
    });

    it("Should allow owners to confirm and execute after the timelock", async function () {
      // Proposer already confirmed; a second owner reaches the threshold.
      await expect(multiSig.connect(owner2).confirmTransaction(0))
        .to.emit(multiSig, "TransactionConfirmed")
        .withArgs(0, owner2.address);

      let tx = await multiSig.transactions(0);
      expect(tx.confirmations).to.equal(2);

      // The 2-day timelock still blocks execution.
      await expect(multiSig.connect(owner1).executeTransaction(0)).to.be.revertedWith(
        "Timelock delay active"
      );

      await time.increase(TIMELOCK_DELAY + 1);

      await expect(multiSig.connect(owner1).executeTransaction(0))
        .to.emit(multiSig, "TransactionExecuted")
        .withArgs(0);

      tx = await multiSig.transactions(0);
      expect(tx.executed).to.equal(true);

      const [storedHash] = await target.getDocument(receiver.address, "RC_BOOK");
      expect(storedHash).to.equal(ethers.id("doc-1"));
    });

    it("Should not execute below the confirmation threshold", async function () {
      await time.increase(TIMELOCK_DELAY + 1);

      // Only the proposer's auto-confirmation (1 < 2 required).
      await expect(multiSig.connect(owner1).executeTransaction(0)).to.be.revertedWith(
        "Insufficient confirmations"
      );
    });

    it("Should reject double confirmation by the same owner", async function () {
      await expect(
        multiSig.connect(owner1).confirmTransaction(0)
      ).to.be.revertedWith("Already confirmed");
    });

    it("Should reject confirmation of an executed transaction", async function () {
      await multiSig.connect(owner2).confirmTransaction(0);
      await time.increase(TIMELOCK_DELAY + 1);
      await multiSig.connect(owner1).executeTransaction(0);

      await expect(
        multiSig.connect(owner3).confirmTransaction(0)
      ).to.be.revertedWith("Tx already executed");
    });
  });
});
