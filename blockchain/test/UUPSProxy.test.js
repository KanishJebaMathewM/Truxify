const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("TruxifyUpgradeable", function () {
  let truxify, proxy, owner, addr1, addr2, daoAddress;

  beforeEach(async function () {
    [owner, addr1, addr2, daoAddress] = await ethers.getSigners();

    // Deploy implementation
    const TruxifyUpgradeable = await ethers.getContractFactory("TruxifyUpgradeable");
    const implementation = await TruxifyUpgradeable.deploy();
    await implementation.waitForDeployment();

    // Deploy proxy
    const UUPSProxy = await ethers.getContractFactory("UUPSProxy");
    const initializeData = implementation.interface.encodeFunctionData("initialize");
    const proxyContract = await UUPSProxy.deploy(
      await implementation.getAddress(),
      initializeData
    );
    await proxyContract.waitForDeployment();

    truxify = await ethers.getContractAt("TruxifyUpgradeable", await proxyContract.getAddress());
  });

  describe("Escrow Management", function () {
    it("Should create escrow", async function () {
      const amount = ethers.parseEther("1");
      await truxify.createEscrow(addr1.address, amount, { value: amount });
      
      const escrowId = await truxify.getEscrowCount();
      expect(escrowId).to.equal(1);
    });

    it("Should release escrow", async function () {
      const amount = ethers.parseEther("1");
      await truxify.createEscrow(addr1.address, amount, { value: amount });
      
      const escrowId = 1;
      await truxify.releaseEscrow(escrowId);
      
      const escrow = await truxify.getEscrow(escrowId);
      expect(escrow.released).to.be.true;
    });

    it("Should dispute escrow", async function () {
      const amount = ethers.parseEther("1");
      await truxify.createEscrow(addr1.address, amount, { value: amount });
      
      const escrowId = 1;
      await truxify.disputeEscrow(escrowId);
      
      const escrow = await truxify.getEscrow(escrowId);
      expect(escrow.disputed).to.be.true;
    });
  });

  describe("DAO Governance", function () {
    it("Should create proposal", async function () {
      await truxify.grantDAORole(daoAddress.address);
      
      await truxify.connect(daoAddress).createProposal(
        addr2.address,
        "Upgrade to new version"
      );
      
      const proposalCount = await truxify.getProposalCount();
      expect(proposalCount).to.equal(1);
    });

    it("Should vote on proposal", async function () {
      await truxify.grantDAORole(daoAddress.address);
      
      await truxify.connect(daoAddress).createProposal(
        addr2.address,
        "Upgrade to new version"
      );
      
      await truxify.connect(daoAddress).vote(1, true);
      
      const proposal = await truxify.proposals(1);
      expect(proposal.votesFor).to.equal(1);
    });
  });

  describe("Emergency Functions", function () {
    it("Should pause contract", async function () {
      await truxify.emergencyPause();
      
      await expect(
        truxify.createEscrow(addr1.address, ethers.parseEther("1"), { value: ethers.parseEther("1") })
      ).to.be.revertedWith("Pausable: paused");
    });

    it("Should unpause contract", async function () {
      await truxify.emergencyPause();
      await truxify.emergencyUnpause();
      
      const amount = ethers.parseEther("1");
      await truxify.createEscrow(addr1.address, amount, { value: amount });
      
      const escrowId = await truxify.getEscrowCount();
      expect(escrowId).to.equal(1);
    });
  });
});