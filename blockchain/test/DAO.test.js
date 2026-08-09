const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DAO Quadratic Voting", function () {
  it("Should calculate quadratic cost = votes^2 correctly", async function () {
    const [owner, voter] = await ethers.getSigners();
    
    const DAOToken = await ethers.getContractFactory("DAOToken");
    const token = await DAOToken.deploy();
    
    const DAO = await ethers.getContractFactory("DAO");
    const dao = await DAO.deploy(await token.getAddress());

    await token.transfer(voter.address, 100);
    await token.connect(voter).approve(await dao.getAddress(), 100);

    await dao.createProposal("Reduce Corridor Tariff by 5%", 3600);

    // Vote 3 votes -> Cost = 3^2 = 9 tokens
    await dao.connect(voter).voteQuadratic(0, 3);

    const proposal = await dao.proposals(0);
    expect(proposal.voteCount).to.equal(3);
    expect(await token.balanceOf(voter.address)).to.equal(91); // 100 - 9 = 91
  });
});
