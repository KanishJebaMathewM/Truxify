const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

async function expectRevert(promise, expectedMessage) {
  try {
    await promise;
    expect.fail("Expected transaction to revert");
  } catch (error) {
    const reason =
      error.reason ??
      error.info?.error?.message ??
      error.shortMessage ??
      error.message ??
      "";
    if (!reason.toLowerCase().includes(expectedMessage.toLowerCase())) {
      const fullMsg = JSON.stringify(error).toLowerCase();
      if (!fullMsg.includes(expectedMessage.toLowerCase())) {
        expect.fail(
          `Expected revert reason to include "${expectedMessage}", got: "${reason}"`
        );
      }
    }
  }
}

describe("DAO Quadratic Voting", function () {
  let token, dao;
  let voter;

  beforeEach(async function () {
    const [owner, v] = await ethers.getSigners();
    voter = v;

    const DAOToken = await ethers.getContractFactory("DAOToken");
    token = await DAOToken.deploy();

    const DAO = await ethers.getContractFactory("DAO");
    dao = await DAO.deploy(await token.getAddress());

    await token.transfer(voter.address, 1_000_000);
    await token.connect(voter).approve(await dao.getAddress(), 1_000_000);

    await dao.registerVoter(ethers.id("identity:voter"));

    await dao.createProposal("Reduce Corridor Tariff by 5%", 3600);
  });

  it("charges quadratic cost = votes^2 for a single vote call", async function () {
    const balanceBefore = await token.balanceOf(voter.address);

    await dao.connect(voter).voteQuadratic(0, 3);

    const proposal = await dao.proposals(0);
    expect(proposal.voteCount).to.equal(3n);
    expect(await dao.votesCast(0, voter.address)).to.equal(3n);
    expect(await token.balanceOf(voter.address)).to.equal(
      balanceBefore - 9n
    );
  });

  it("charges the cumulative quadratic price when votes are split across calls", async function () {
    const balanceBefore = await token.balanceOf(voter.address);

    await dao.connect(voter).voteQuadratic(0, 1); // cost 1
    await dao.connect(voter).voteQuadratic(0, 1); // cost 4 - 1 = 3
    await dao.connect(voter).voteQuadratic(0, 1); // cost 9 - 4 = 5
    await dao.connect(voter).voteQuadratic(0, 1); // cost 16 - 9 = 7
    await dao.connect(voter).voteQuadratic(0, 1); // cost 25 - 16 = 9

    const proposal = await dao.proposals(0);
    expect(proposal.voteCount).to.equal(5n);
    // 5 votes split across 5 calls must cost the same as 5 votes in one call.
    expect(await token.balanceOf(voter.address)).to.equal(
      balanceBefore - 25n
    );
  });

  it("keeps total cost quadratic for larger split vote totals", async function () {
    const balanceBefore = await token.balanceOf(voter.address);

    await dao.connect(voter).voteQuadratic(0, 4); // cost 16
    await dao.connect(voter).voteQuadratic(0, 6); // cost 100 - 16 = 84

    const proposal = await dao.proposals(0);
    expect(proposal.voteCount).to.equal(10n);
    expect(await token.balanceOf(voter.address)).to.equal(
      balanceBefore - 100n
    );
  });

  it("reverts when voting after the deadline", async function () {
    await time.increase(3601);

    await expectRevert(
      dao.connect(voter).voteQuadratic(0, 1),
      "Voting period ended"
    );
  });

  it("reverts when voting zero votes", async function () {
    await expectRevert(dao.connect(voter).voteQuadratic(0, 0), "Votes must be > 0");
  });

  it("refunds the sum of per-call quadratic costs, not (Σvotes)^2", async function () {
    const balanceBefore = await token.balanceOf(voter.address);

    // Split 5 votes across calls: 3 then 2 → deposit 9 + 4 = 13 tokens.
    await dao.connect(voter).voteQuadratic(0, 3); // cost 9
    await dao.connect(voter).voteQuadratic(0, 2); // cost 4

    expect(await token.balanceOf(voter.address)).to.equal(balanceBefore - 13n);

    await dao.connect(voter).releaseVotes(0);

    // Must refund exactly 13 (Σ vᵢ²), NOT (3+2)² = 25.
    expect(await token.balanceOf(voter.address)).to.equal(balanceBefore);
    expect(await dao.tokensHeld(0, voter.address)).to.equal(13n);
  });

  it("reverts when releasing votes that were never cast", async function () {
    await expectRevert(dao.connect(voter).releaseVotes(0), "No votes to release");
  });

  it("reverts when releasing the same votes twice", async function () {
    await dao.connect(voter).voteQuadratic(0, 4); // cost 16
    await dao.connect(voter).releaseVotes(0);

    await expectRevert(dao.connect(voter).releaseVotes(0), "Already released");
  });

  it("reverts when an unregistered address tries to vote", async function () {
    const [, , attacker] = await ethers.getSigners();

    await token.transfer(attacker.address, 1_000_000);
    await token.connect(attacker).approve(await dao.getAddress(), 1_000_000);

    await expectRevert(
      dao.connect(attacker).voteQuadratic(0, 1),
      "Voter not registered"
    );
  });

  it("rejects registering the same identity on a second address", async function () {
    const [, , other] = await ethers.getSigners();

    await expectRevert(
      dao.connect(other).registerVoter(ethers.id("identity:voter")),
      "Identity already registered"
    );
  });
});
