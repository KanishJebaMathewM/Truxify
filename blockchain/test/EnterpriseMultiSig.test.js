const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EnterpriseMultiSig", function () {
  let multiSig;
  let owner1, owner2, owner3, nonOwner, receiver;
  const NUM_CONFIRMATIONS_REQUIRED = 2;

  beforeEach(async function () {
    [owner1, owner2, owner3, nonOwner, receiver] = await ethers.getSigners();
    const owners = [owner1.address, owner2.address, owner3.address];

    const EnterpriseMultiSig = await ethers.getContractFactory("EnterpriseMultiSig");
    multiSig = await EnterpriseMultiSig.deploy(owners, NUM_CONFIRMATIONS_REQUIRED);
    // await multiSig.waitForDeployment(); // Depends on ethers v6 vs v5. We'll use .deployed() if v5, or just await if v6. 
    // Usually await multiSig.deployed() in v5, or just omit if relying on deploy().
    // Truxify seems to use modern hardhat, but let's be safe.
  });

  describe("Deployment", function () {
    it("Should set the correct owners and required confirmations", async function () {
      expect(await multiSig.numConfirmationsRequired()).to.equal(NUM_CONFIRMATIONS_REQUIRED);
      expect(await multiSig.owners(0)).to.equal(owner1.address);
      expect(await multiSig.isOwner(owner1.address)).to.equal(true);
    });

    it("Should fail if confirmations exceed owners", async function () {
      const EnterpriseMultiSig = await ethers.getContractFactory("EnterpriseMultiSig");
      await expect(
        EnterpriseMultiSig.deploy([owner1.address], 2)
      ).to.be.revertedWith("invalid number of required confirmations");
    });
  });

  describe("Transactions", function () {
    beforeEach(async function () {
      // Send some ETH to the contract
      await owner1.sendTransaction({
        to: multiSig.target || multiSig.address, // handle both ethers v5 and v6
        value: ethers.parseEther ? ethers.parseEther("1.0") : ethers.utils.parseEther("1.0"),
      });
    });

    it("Should allow an owner to submit a transaction", async function () {
      await expect(
        multiSig.connect(owner1).submitTransaction(receiver.address, 100, "0x")
      )
        .to.emit(multiSig, "SubmitTransaction")
        .withArgs(owner1.address, 0, receiver.address, 100, "0x");

      const tx = await multiSig.getTransaction(0);
      expect(tx.to).to.equal(receiver.address);
      expect(tx.value).to.equal(100);
      expect(tx.executed).to.equal(false);
      expect(tx.numConfirmations).to.equal(0);
    });

    it("Should not allow non-owner to submit a transaction", async function () {
      await expect(
        multiSig.connect(nonOwner).submitTransaction(receiver.address, 100, "0x")
      ).to.be.revertedWith("not owner");
    });
  });

  describe("Owner Management and Rotation", function () {
    it("Should allow adding an owner via multi-sig execution", async function () {
        const addOwnerData = multiSig.interface.encodeFunctionData("addOwner", [nonOwner.address]);
        
        await multiSig.connect(owner1).submitTransaction(multiSig.target || multiSig.address, 0, addOwnerData);
        await multiSig.connect(owner1).confirmTransaction(0);
        await multiSig.connect(owner2).confirmTransaction(0);

        await expect(multiSig.connect(owner1).executeTransaction(0))
            .to.emit(multiSig, "OwnerAdded")
            .withArgs(nonOwner.address);

        expect(await multiSig.isOwner(nonOwner.address)).to.equal(true);
        expect((await multiSig.getOwners()).length).to.equal(4);
    });

    it("Should allow removing an owner and changing requirement via multi-sig execution", async function () {
        const removeOwnerData = multiSig.interface.encodeFunctionData("removeOwner", [owner3.address]);
        
        await multiSig.connect(owner1).submitTransaction(multiSig.target || multiSig.address, 0, removeOwnerData);
        await multiSig.connect(owner1).confirmTransaction(0);
        await multiSig.connect(owner2).confirmTransaction(0);

        await expect(multiSig.connect(owner1).executeTransaction(0))
            .to.emit(multiSig, "OwnerRemoved")
            .withArgs(owner3.address);

        expect(await multiSig.isOwner(owner3.address)).to.equal(false);
        expect((await multiSig.getOwners()).length).to.equal(2);
    });
  });

  describe("Confirm and Execute", function () {
    const value = 1000;

    beforeEach(async function () {
      await owner1.sendTransaction({
        to: multiSig.target || multiSig.address,
        value: value,
      });
      await multiSig.connect(owner1).submitTransaction(receiver.address, value, "0x");
    });

    it("Should allow owners to confirm and execute", async function () {
      // Owner 1 confirms
      await expect(multiSig.connect(owner1).confirmTransaction(0))
        .to.emit(multiSig, "ConfirmTransaction")
        .withArgs(owner1.address, 0);

      let tx = await multiSig.getTransaction(0);
      expect(tx.numConfirmations).to.equal(1);

      // Cannot execute yet
      await expect(multiSig.connect(owner1).executeTransaction(0)).to.be.revertedWith(
        "cannot execute tx"
      );

      // Owner 2 confirms
      await multiSig.connect(owner2).confirmTransaction(0);

      // Now it can execute
      await expect(multiSig.connect(owner1).executeTransaction(0))
        .to.emit(multiSig, "ExecuteTransaction")
        .withArgs(owner1.address, 0);

      tx = await multiSig.getTransaction(0);
      expect(tx.executed).to.equal(true);
    });

    it("Should allow owner to revoke confirmation", async function () {
      await multiSig.connect(owner1).confirmTransaction(0);
      
      await expect(multiSig.connect(owner1).revokeConfirmation(0))
        .to.emit(multiSig, "RevokeConfirmation")
        .withArgs(owner1.address, 0);

      const tx = await multiSig.getTransaction(0);
      expect(tx.numConfirmations).to.equal(0);
    });
  });
});
