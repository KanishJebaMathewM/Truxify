const { expect } = require("chai");
const { ethers } = require("hardhat");

function getLogTopic(signature) {
  return ethers.id(signature);
}

describe("ZKCP decryption key event disclosure", function () {
  it("publishes the decryption key in PaymentReleased (atomic delivery, #14779)", async function () {
    const [buyer, seller] = await ethers.getSigners();
    const ZKCP = await ethers.getContractFactory("ZKCP");
    const zkcp = await ZKCP.deploy();

    const agreementId = ethers.keccak256(ethers.toUtf8Bytes("AGREEMENT_EVENT_PRIVACY"));
    const decryptionKey = ethers.keccak256(
      ethers.toUtf8Bytes("DECRYPTION_SECRET_EVENT_PRIVACY")
    );
    const dataHash = ethers.keccak256(ethers.toUtf8Bytes("DATASET_EVENT_PRIVACY"));
    // Commitment binds key + dataset: sha256(decryptionKey || actualDataHash)
    const commitment = ethers.sha256(ethers.concat([decryptionKey, dataHash]));
    const amount = ethers.parseEther("1.0");

    await zkcp.connect(buyer).lockPayment(
      agreementId,
      seller.address,
      commitment,
      3600,
      { value: amount }
    );

    const tx = await zkcp.connect(seller).claimPayment(agreementId, decryptionKey, dataHash);
    const receipt = await tx.wait();

    const oldPaymentReleasedTopic = getLogTopic(
      "PaymentReleased(bytes32,bytes32)"
    );
    // The current event deliberately discloses the decryption key on-chain:
    // revealing it is what atomically settles the fair exchange, so the buyer
    // learns the key in the same transaction that pays the seller (#14779).
    const newPaymentReleasedTopic = getLogTopic(
      "PaymentReleased(bytes32,bytes32,bytes32,address,uint256)"
    );

    const oldEventLogs = receipt.logs.filter(
      (log) => log.topics[0] === oldPaymentReleasedTopic
    );
    expect(oldEventLogs).to.have.lengthOf(0);

    const paymentReleasedLogs = receipt.logs.filter(
      (log) => log.topics[0] === newPaymentReleasedTopic
    );
    expect(paymentReleasedLogs).to.have.lengthOf(1);

    const parsed = zkcp.interface.parseLog(paymentReleasedLogs[0]);
    expect(parsed).to.not.equal(null);
    expect(parsed.args.agreementId).to.equal(agreementId);
    expect(parsed.args.decryptionKey).to.equal(decryptionKey);
    expect(parsed.args.actualDataHash).to.equal(dataHash);
    expect(parsed.args.seller).to.equal(seller.address);
    expect(parsed.args.payoutAmount).to.equal(amount);
  });
});
