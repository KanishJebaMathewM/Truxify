const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * Helper: assert a transaction reverts with a specific message.
 * Replaces `.to.be.revertedWith(...)` which is broken with chai v6.
 */
async function expectRevert(promise, expectedMessage) {
  try {
    await promise;
    expect.fail("Expected transaction to revert");
  } catch (error) {
    // ethers v6 + Hardhat: extract revert reason from various error shapes
    // String revert: error.reason or within error.message
    // Custom error: error.info?.error?.message or the full error serialization
    const reason =
      error.reason ??
      error.info?.error?.message ??
      error.shortMessage ??
      error.message ??
      "";
    const lowerReason = reason.toLowerCase();
    if (!lowerReason.includes(expectedMessage.toLowerCase())) {
      // For custom errors (OZ v5), the error data may contain the error name
      // Try to extract from the full error string as fallback
      const fullMsg = JSON.stringify(error).toLowerCase();
      if (!fullMsg.includes(expectedMessage.toLowerCase())) {
        expect.fail(
          `Expected revert reason to include "${expectedMessage}", got: "${reason}"`
        );
      }
    }
  }
}

describe("TruxifyUpgradeable", function () {
  let truxify, implementation, v2Implementation;
  let owner, upgrader, daoMember, voter1, voter2, other;

  const ONE_DAY = 86_400;

  beforeEach(async function () {
    [owner, upgrader, daoMember, voter1, voter2, other] =
      await ethers.getSigners();

    // Deploy implementation
    const TruxifyUpgradeable = await ethers.getContractFactory(
      "TruxifyUpgradeable"
    );
    implementation = await TruxifyUpgradeable.deploy();
    await implementation.waitForDeployment();

    // Deploy V2 implementation (for upgrade testing)
    v2Implementation = await TruxifyUpgradeable.deploy();
    await v2Implementation.waitForDeployment();

    // Deploy proxy
    const UUPSProxy = await ethers.getContractFactory("UUPSProxy");
    const initializeData =
      implementation.interface.encodeFunctionData("initialize");
    const proxyContract = await UUPSProxy.deploy(
      await implementation.getAddress(),
      initializeData
    );
    await proxyContract.waitForDeployment();

    truxify = await ethers.getContractAt(
      "TruxifyUpgradeable",
      await proxyContract.getAddress()
    );

    // ── Test-friendly DAO config ─────────────────────────────────────────
    // Set quorum to 3 (voter1 + voter2 + daoMember) so we can reach it.
    // Set threshold to 51% so majority is clear.
    // Set voting period to minimum (1 day = 86400s). Use time.increase()
    // in tests to fast-forward past it.
    await truxify.setDAOQuorum(3);
    await truxify.setDAOThreshold(51);
    await truxify.setDAOVotingPeriod(86400);

    // Grant roles
    await truxify.grantUpgraderRole(upgrader.address);
    await truxify.grantDAORole(daoMember.address);
  });

  // ══════════════════════════════════════════════════════════════════
  // Escrow Management
  // ══════════════════════════════════════════════════════════════════

  describe("Escrow Management", function () {
    it("Should create escrow", async function () {
      const amount = ethers.parseEther("1");
      await truxify.createEscrow(voter1.address, amount, { value: amount });

      const escrowId = await truxify.getEscrowCount();
      expect(escrowId).to.equal(1n);
    });

    it("Should release escrow", async function () {
      const amount = ethers.parseEther("1");
      await truxify.createEscrow(voter1.address, amount, { value: amount });

      const escrowId = 1;
      await truxify.releaseEscrow(escrowId);

      const escrow = await truxify.getEscrow(escrowId);
      expect(escrow.released).to.be.true;
    });

    it("Should dispute escrow", async function () {
      const amount = ethers.parseEther("1");
      await truxify.createEscrow(voter1.address, amount, { value: amount });

      const escrowId = 1;
      await truxify.disputeEscrow(escrowId);

      const escrow = await truxify.getEscrow(escrowId);
      expect(escrow.disputed).to.be.true;
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // DAO Governance — Proposal Lifecycle
  // ══════════════════════════════════════════════════════════════════

  describe("DAO Governance — Proposal Lifecycle", function () {
    it("Should create proposal", async function () {
      await truxify.connect(daoMember).createProposal(
        other.address,
        "Upgrade to new version"
      );

      const proposalCount = await truxify.getProposalCount();
      expect(proposalCount).to.equal(1n);
    });

    it("Should vote on proposal", async function () {
      await truxify.connect(daoMember).createProposal(
        other.address,
        "Upgrade to new version"
      );

      await truxify.connect(daoMember).vote(1, true);

      const proposal = await truxify.proposals(1);
      expect(proposal.votesFor).to.equal(1n);
    });

    it("Should not allow double voting", async function () {
      await truxify.connect(daoMember).createProposal(
        other.address,
        "Upgrade to new version"
      );

      await truxify.connect(daoMember).vote(1, true);
      await expectRevert(
        truxify.connect(daoMember).vote(1, true),
        "Already voted"
      );
    });

    it("Should not allow voting after deadline", async function () {
      await truxify.connect(daoMember).createProposal(
        other.address,
        "Upgrade to new version"
      );

      await time.increase(86401);

      await expectRevert(
        truxify.connect(daoMember).vote(1, true),
        "Voting ended"
      );
    });

    it("Should not allow execute before voting ends", async function () {
      await truxify.connect(daoMember).createProposal(
        other.address,
        "Upgrade to new version"
      );

      await expectRevert(
        truxify.executeProposal(1),
        "Voting not ended"
      );
    });

    it("Should not allow execute without quorum", async function () {
      await truxify.connect(daoMember).createProposal(
        other.address,
        "Upgrade to new version"
      );

      // Only 1 vote, quorum is 3
      await truxify.connect(daoMember).vote(1, true);
      await time.increase(86401);

      await expectRevert(
        truxify.executeProposal(1),
        "Quorum not reached"
      );
    });

    it("Should not execute a proposal that fails threshold", async function () {
      await truxify.connect(daoMember).createProposal(
        other.address,
        "Test proposal"
      );

      // Vote: 2 for, 2 against — threshold is 51% so 2/4 = 50% < 51% → fails
      await truxify.connect(daoMember).vote(1, true);
      await truxify.connect(voter1).vote(1, true);
      await truxify.connect(voter2).vote(1, false);
      // Need a 4th voter: DAO role to other
      await truxify.grantDAORole(other.address);
      await truxify.connect(other).vote(1, false);

      await time.increase(86401);

      // The contract does NOT revert on threshold failure — it marks passed=false
      await truxify.executeProposal(1);

      const proposal = await truxify.proposals(1);
      expect(proposal.executed).to.be.true;
      expect(proposal.passed).to.be.false;
      expect(proposal.votesFor).to.equal(2n);
      expect(proposal.votesAgainst).to.equal(2n);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // DAO Governance — Full Upgrade Flow
  // ══════════════════════════════════════════════════════════════════

  describe("DAO Governance — Upgrade Execution", function () {
    it("Should execute proposal and perform upgrade when quorum and threshold met", async function () {
      const v2Address = await v2Implementation.getAddress();

      // Create proposal pointing to V2 implementation
      await truxify.connect(daoMember).createProposal(
        v2Address,
        "Upgrade to V2"
      );

      // Vote: 3 for (daoMember + voter1 + voter2), 0 against = 100% approval
      await truxify.connect(daoMember).vote(1, true);
      await truxify.connect(voter1).vote(1, true);
      await truxify.connect(voter2).vote(1, true);

      // Fast-forward past voting period
      await time.increase(86401);

      // Execute proposal — this should perform the upgrade via upgradeToAndCall
      const result = await truxify.executeProposal(1);

      // Verify upgrade history was recorded
      const upgradeCount = await truxify.getUpgradeCount();
      expect(upgradeCount).to.equal(1n);

      const record = await truxify.getUpgradeHistory(1);
      expect(record.implementation).to.equal(v2Address);
      expect(record.reason).to.equal("Upgrade to V2");

      // Verify proposal was marked executed and passed
      const proposal = await truxify.proposals(1);
      expect(proposal.executed).to.be.true;
      expect(proposal.passed).to.be.true;
    });

    it("Should reject upgrade via upgradeToAndCall() without DAO approval", async function () {
      const v2Address = await v2Implementation.getAddress();

      // upgrader tries to upgrade directly without DAO approval
      // OZ v5 uses upgradeToAndCall (upgradeTo was removed)
      await expectRevert(
        truxify.connect(upgrader).upgradeToAndCall(v2Address, "0x"),
        "Upgrade not approved by DAO"
      );
    });

    it("Should reject upgrade via upgradeToAndCall() without DAO approval even with UPGRADER_ROLE", async function () {
      const v2Address = await v2Implementation.getAddress();

      // DAO approval flag is only set by executeProposal, not by upgradeToAndCall
      await expectRevert(
        truxify.connect(upgrader).upgradeToAndCall(v2Address, "0x"),
        "Upgrade not approved by DAO"
      );
    });

    it("Should prevent replay of upgrade approval flag after execution", async function () {
      const v2Address = await v2Implementation.getAddress();

      // DAO approves and executes upgrade
      await truxify.connect(daoMember).createProposal(v2Address, "Upgrade");
      await truxify.connect(daoMember).vote(1, true);
      await truxify.connect(voter1).vote(1, true);
      await truxify.connect(voter2).vote(1, true);
      await time.increase(86401);
      await truxify.executeProposal(1);

      // Flag was cleared by executeProposal — trying upgradeToAndCall again should fail
      await expectRevert(
        truxify.connect(upgrader).upgradeToAndCall(v2Address, "0x"),
        "Upgrade not approved by DAO"
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Emergency Upgrade Timelock
  // ══════════════════════════════════════════════════════════════════

  describe("Emergency Upgrade — Timelock", function () {
    it("Should register an emergency upgrade request", async function () {
      const v2Address = await v2Implementation.getAddress();

      await truxify.connect(upgrader).requestEmergencyUpgrade(
        v2Address,
        "Critical security fix"
      );

      const timestamp = await truxify.emergencyUpgradeRequests(v2Address);
      expect(timestamp).to.not.equal(0n);
    });

    it("Should reject duplicate emergency upgrade request for same implementation", async function () {
      const v2Address = await v2Implementation.getAddress();

      await truxify.connect(upgrader).requestEmergencyUpgrade(
        v2Address,
        "Critical security fix"
      );

      await expectRevert(
        truxify.connect(upgrader).requestEmergencyUpgrade(
          v2Address,
          "Another emergency"
        ),
        "Emergency upgrade already requested for this implementation"
      );
    });

    it("Should reject emergency upgrade request from non-upgrader", async function () {
      const v2Address = await v2Implementation.getAddress();

      await expectRevert(
        truxify.connect(other).requestEmergencyUpgrade(
          v2Address,
          "Malicious upgrade"
        ),
        "AccessControlUnauthorizedAccount"
      );
    });

    it("Should reject upgrade via upgradeToAndCall() before timelock elapses", async function () {
      const v2Address = await v2Implementation.getAddress();

      await truxify.connect(upgrader).requestEmergencyUpgrade(
        v2Address,
        "Critical security fix"
      );

      // EMERGENCY_UPGRADE_TIMELOCK is 2 days
      // Try to upgrade immediately — should fail
      await expectRevert(
        truxify.connect(upgrader).upgradeToAndCall(v2Address, "0x"),
        "Emergency timelock not yet elapsed"
      );
    });

    it("Should execute emergency upgrade after timelock elapses", async function () {
      const v2Address = await v2Implementation.getAddress();

      await truxify.connect(upgrader).requestEmergencyUpgrade(
        v2Address,
        "Critical security fix"
      );

      // Fast-forward past 2-day timelock
      await time.increase(2 * ONE_DAY + 1);

      // Now upgrade should succeed — use upgradeToAndCall (OZ v5)
      await truxify.connect(upgrader).upgradeToAndCall(v2Address, "0x");

      // Verify upgrade history was recorded
      const upgradeCount = await truxify.getUpgradeCount();
      expect(upgradeCount).to.equal(1n);

      // Verify emergency request was cleared
      const requestTimestamp = await truxify.emergencyUpgradeRequests(v2Address);
      expect(requestTimestamp).to.equal(0n);
    });

    it("Should cancel pending emergency upgrade", async function () {
      const v2Address = await v2Implementation.getAddress();

      await truxify.connect(upgrader).requestEmergencyUpgrade(
        v2Address,
        "Critical security fix"
      );

      // Owner (DEFAULT_ADMIN_ROLE) cancels the request
      await truxify.connect(owner).cancelEmergencyUpgrade(v2Address);

      const requestTimestamp = await truxify.emergencyUpgradeRequests(v2Address);
      expect(requestTimestamp).to.equal(0n);
    });

    it("Should reject cancel from non-admin", async function () {
      const v2Address = await v2Implementation.getAddress();

      await truxify.connect(upgrader).requestEmergencyUpgrade(
        v2Address,
        "Critical security fix"
      );

      await expectRevert(
        truxify.connect(other).cancelEmergencyUpgrade(v2Address),
        "AccessControlUnauthorizedAccount"
      );
    });

    it("Should reject cancel when no pending request exists", async function () {
      const v2Address = await v2Implementation.getAddress();

      await expectRevert(
        truxify.connect(owner).cancelEmergencyUpgrade(v2Address),
        "No pending emergency upgrade for this implementation"
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Emergency Functions — Pause / Unpause
  // ══════════════════════════════════════════════════════════════════

  describe("Emergency Functions", function () {
    it("Should pause contract", async function () {
      await truxify.emergencyPause();

      await expectRevert(
        truxify.createEscrow(voter1.address, ethers.parseEther("1"), {
          value: ethers.parseEther("1"),
        }),
        "EnforcedPause"
      );
    });

    it("Should unpause contract", async function () {
      await truxify.emergencyPause();
      await truxify.emergencyUnpause();

      const amount = ethers.parseEther("1");
      await truxify.createEscrow(voter1.address, amount, { value: amount });

      const escrowId = await truxify.getEscrowCount();
      expect(escrowId).to.equal(1n);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Role Management
  // ══════════════════════════════════════════════════════════════════

  describe("Role Management", function () {
    it("Should grant DAO role", async function () {
      await truxify.grantDAORole(voter1.address);
      expect(
        await truxify.hasRole(await truxify.DAO_ROLE(), voter1.address)
      ).to.be.true;
    });

    it("Should grant Upgrader role", async function () {
      await truxify.grantUpgraderRole(voter1.address);
      expect(
        await truxify.hasRole(await truxify.UPGRADER_ROLE(), voter1.address)
      ).to.be.true;
    });

    it("Should grant Pauser role", async function () {
      await truxify.grantPauserRole(voter1.address);
      expect(
        await truxify.hasRole(await truxify.PAUSER_ROLE(), voter1.address)
      ).to.be.true;
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // DAO Configuration
  // ══════════════════════════════════════════════════════════════════

  describe("DAO Configuration", function () {
    it("Should update voting period", async function () {
      await truxify.setDAOVotingPeriod(5 * ONE_DAY);
      expect(await truxify.daoVotingPeriod()).to.equal(BigInt(5 * ONE_DAY));
    });

    it("Should reject voting period less than 1 day", async function () {
      await expectRevert(
        truxify.setDAOVotingPeriod(3600),
        "Period too short"
      );
    });

    it("Should update quorum", async function () {
      await truxify.setDAOQuorum(10);
      expect(await truxify.daoQuorum()).to.equal(10n);
    });

    it("Should reject zero quorum", async function () {
      await expectRevert(
        truxify.setDAOQuorum(0),
        "Quorum must be > 0"
      );
    });
  });
});
