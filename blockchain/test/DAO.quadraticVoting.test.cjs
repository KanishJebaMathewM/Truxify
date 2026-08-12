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
});
