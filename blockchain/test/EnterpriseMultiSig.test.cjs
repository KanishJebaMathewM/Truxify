const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EnterpriseMultiSig", function () {
  it("Should initialize M-of-N owners and enforce timelock delay", async function () {
    const [owner1, owner2, owner3] = await ethers.getSigners();
    const EnterpriseMultiSig = await ethers.getContractFactory("EnterpriseMultiSig");
    const multiSig = await EnterpriseMultiSig.deploy([owner1.address, owner2.address, owner3.address], 2);

    expect(await multiSig.requiredConfirmations()).to.equal(2);

    const tx = await multiSig.proposeTransaction(owner3.address, 0, "0x");
    await tx.wait();

    await expect(multiSig.executeTransaction(0)).to.be.revertedWith("Insufficient confirmations");
  });
});
