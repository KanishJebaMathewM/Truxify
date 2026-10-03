const { expect } = require("chai");
const { ethers } = require("hardhat");

function getLogTopic(signature) {
  return ethers.id(signature);
}

describe("ZKCP decryption key event disclosure", function () {
  it("does not publish the decryption key in PaymentReleased", async function () {
    const [buyer, seller] = await ethers.getSigners();
    const ZKCP = await ethers.getContractFactory("ZKCP");
    const zkcp = await ZKCP.deploy();

    const agreementId = ethers.keccak256(ethers.toUtf8Bytes("AGREEMENT_EVENT_PRIVACY"));
    const decryptionKey = ethers.keccak256(
      ethers.toUtf8Bytes("DECRYPTION_SECRET_EVENT_PRIVACY")
    );
    const dataHash = ethers.sha256(ethers.toBeHex(decryptionKey));
    const amount = ethers.parseEther("1.0");

    await zkcp.connect(buyer).lockPayment(
      agreementId,
      seller.address,
      dataHash,
      3600,
      { value: amount }
    );

    const tx = await zkcp.connect(seller).claimPayment(agreementId, decryptionKey);
    const receipt = await tx.wait();

    const oldPaymentReleasedTopic = getLogTopic(
      "PaymentReleased(bytes32,bytes32)"
    );
    const newPaymentReleasedTopic = getLogTopic(
      "PaymentReleased(bytes32,address,uint256)"
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
    expect(parsed.args.seller).to.equal(seller.address);
    expect(parsed.args.amount).to.equal(amount);

    const secretHex = decryptionKey.toLowerCase();
    const eventPayload = paymentReleasedLogs[0].data.toLowerCase();
    expect(eventPayload).to.not.include(secretHex.slice(2));
  });
});
