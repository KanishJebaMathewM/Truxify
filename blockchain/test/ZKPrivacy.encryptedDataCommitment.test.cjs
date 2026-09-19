const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ZKPrivacy encrypted data commitment", function () {
    it("binds encryptedData to the stored commitment", async function () {
        const [sender, recipient] = await ethers.getSigners();
        const ZKPrivacy = await ethers.getContractFactory("ZKPrivacy");
        const zkPrivacy = await ZKPrivacy.deploy(ethers.ZeroAddress);
        await zkPrivacy.waitForDeployment();

        const amount = ethers.parseEther("1");
        const encryptedData = ethers.toUtf8Bytes("encrypted private payload");
        const alternativeData = ethers.toUtf8Bytes("different encrypted payload");
        const encryptedDataHash = ethers.keccak256(encryptedData);

        const tx = await zkPrivacy.createPrivateTransaction(
            recipient.address,
            amount,
            encryptedData,
            { value: amount }
        );
        const receipt = await tx.wait();
        const block = await ethers.provider.getBlock(receipt.blockNumber);
        const counter = await zkPrivacy.getTransactionCount();
        const txId = ethers.solidityPackedKeccak256(
            ["uint256", "uint256"],
            [block.timestamp, counter]
        );
        const stored = await zkPrivacy.getTransaction(txId);

        const expectedCommitment = ethers.solidityPackedKeccak256(
            ["uint256", "address", "uint256", "bytes32"],
            [block.timestamp, sender.address, amount, encryptedDataHash]
        );
        const commitmentForAlternativeData = ethers.solidityPackedKeccak256(
            ["uint256", "address", "uint256", "bytes32"],
            [
                block.timestamp,
                sender.address,
                amount,
                ethers.keccak256(alternativeData)
            ]
        );

        expect(stored.commitment).to.equal(expectedCommitment);
        expect(stored.commitment).to.not.equal(commitmentForAlternativeData);
    });
});
