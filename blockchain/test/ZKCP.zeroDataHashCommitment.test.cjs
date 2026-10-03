const { expect } = require("chai");
const { ethers } = require("hardhat");

async function deployZKCP() {
    const ZKCP = await ethers.getContractFactory("ZKCP");
    const zkcp = await ZKCP.deploy();
    await zkcp.waitForDeployment();
    return zkcp;
}

describe("ZKCP zero data hash commitment", function () {
    it("rejects a zero data hash commitment during escrow creation", async function () {
        const [buyer, seller] = await ethers.getSigners();
        const zkcp = await deployZKCP();
        const agreementId = ethers.keccak256(ethers.toUtf8Bytes("ZERO_COMMITMENT"));

        await expect(
            zkcp.connect(buyer).lockPayment(
                agreementId,
                seller.address,
                ethers.ZeroHash,
                3600,
                { value: ethers.parseEther("1") }
            )
        ).to.be.revertedWith("Data hash commitment required");
    });

    it("accepts a non-zero commitment and preserves the existing claim path", async function () {
        const [buyer, seller] = await ethers.getSigners();
        const zkcp = await deployZKCP();
        const agreementId = ethers.keccak256(ethers.toUtf8Bytes("VALID_COMMITMENT"));
        const key = ethers.keccak256(ethers.toUtf8Bytes("DECRYPTION_KEY"));
        const commitment = ethers.sha256(ethers.toBeHex(key));

        await zkcp.connect(buyer).lockPayment(
            agreementId,
            seller.address,
            commitment,
            3600,
            { value: ethers.parseEther("1") }
        );

        await expect(zkcp.connect(seller).claimPayment(agreementId, key)).to.not.be.reverted;

        const agreement = await zkcp.agreements(agreementId);
        expect(agreement.dataHashCommitment).to.equal(commitment);
        expect(agreement.keyRevealed).to.equal(true);
        expect(agreement.completed).to.equal(true);
    });
});
