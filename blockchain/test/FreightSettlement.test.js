const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FreightSettlement Smart Contract", function () {
  let settlementContract;
  let owner, shipper, carrier, broker, insurer, carbonFund, taxAuthority, oracle;

  const defaultSplits = {
    brokerFeeBps: 250,      // 2.5%
    insuranceFeeBps: 100,   // 1.0%
    carbonOffsetBps: 50,    // 0.5%
    gstRateBps: 1200,       // 12.0%
    tdsRateBps: 100,        // 1.0%
  };

  beforeEach(async function () {
    [owner, shipper, carrier, broker, insurer, carbonFund, taxAuthority, oracle] = await ethers.getSigners();
    const FreightSettlement = await ethers.getContractFactory("FreightSettlement");
    settlementContract = await FreightSettlement.deploy();
    await settlementContract.waitForDeployment();

    await settlementContract.setOracleAuthorization(oracle.address, true);
  });

  it("Should create and fund a freight settlement agreement successfully", async function () {
    const settlementId = ethers.keccak256(ethers.toUtf8Bytes("SETTLEMENT_ORDER_101"));
    const totalAmount = ethers.parseEther("2.0");

    await settlementContract.connect(shipper).createSettlement(
      settlementId,
      carrier.address,
      broker.address,
      insurer.address,
      carbonFund.address,
      taxAuthority.address,
      totalAmount,
      defaultSplits
    );

    const agreement = await settlementContract.getSettlement(settlementId);
    expect(agreement.shipper).to.equal(shipper.address);
    expect(agreement.totalAmountWei).to.equal(totalAmount);
    expect(agreement.state).to.equal(0); // Created

    // Fund the settlement
    await settlementContract.connect(shipper).fundSettlement(settlementId, { value: totalAmount });
    const fundedAgreement = await settlementContract.getSettlement(settlementId);
    expect(fundedAgreement.state).to.equal(1); // Funded
  });

  it("Should execute multi-party settlement disbursements upon delivery attestation", async function () {
    const settlementId = ethers.keccak256(ethers.toUtf8Bytes("SETTLEMENT_ORDER_102"));
    const totalAmount = ethers.parseEther("10.0");

    await settlementContract.connect(shipper).createSettlement(
      settlementId,
      carrier.address,
      broker.address,
      insurer.address,
      carbonFund.address,
      taxAuthority.address,
      totalAmount,
      defaultSplits
    );

    await settlementContract.connect(shipper).fundSettlement(settlementId, { value: totalAmount });
    await settlementContract.connect(oracle).markDispatched(settlementId);

    const carrierBefore = await ethers.provider.getBalance(carrier.address);
    const brokerBefore = await ethers.provider.getBalance(broker.address);
    const taxBefore = await ethers.provider.getBalance(taxAuthority.address);

    // Total deductions = 2.5% + 1.0% + 0.5% + 12.0% + 1.0% = 17% (1.7 ETH)
    // Carrier Net = 83% (8.3 ETH)
    // Broker = 0.25 ETH, Tax = 1.30 ETH
    const tx = await settlementContract.connect(oracle).attestDeliveryAndSettle(settlementId);
    await tx.wait();

    const carrierAfter = await ethers.provider.getBalance(carrier.address);
    const brokerAfter = await ethers.provider.getBalance(broker.address);
    const taxAfter = await ethers.provider.getBalance(taxAuthority.address);

    expect(carrierAfter - carrierBefore).to.equal(ethers.parseEther("8.3"));
    expect(brokerAfter - brokerBefore).to.equal(ethers.parseEther("0.25"));
    expect(taxAfter - taxBefore).to.equal(ethers.parseEther("1.30"));

    const settled = await settlementContract.getSettlement(settlementId);
    expect(settled.isSettled).to.be.true;
    expect(settled.state).to.equal(4); // Settled
  });

  it("Should include accessorial detention pay in carrier disbursement", async function () {
    const settlementId = ethers.keccak256(ethers.toUtf8Bytes("SETTLEMENT_ORDER_103"));
    const totalAmount = ethers.parseEther("5.0");
    const detentionPay = ethers.parseEther("0.5");

    await settlementContract.connect(shipper).createSettlement(
      settlementId,
      carrier.address,
      broker.address,
      insurer.address,
      carbonFund.address,
      taxAuthority.address,
      totalAmount,
      defaultSplits
    );

    await settlementContract.connect(shipper).fundSettlement(settlementId, { value: totalAmount });
    await settlementContract.connect(oracle).markDispatched(settlementId);

    // Add detention pay
    await settlementContract.connect(oracle).applyDetentionPay(settlementId, detentionPay, { value: detentionPay });

    const carrierBefore = await ethers.provider.getBalance(carrier.address);
    await settlementContract.connect(oracle).attestDeliveryAndSettle(settlementId);
    const carrierAfter = await ethers.provider.getBalance(carrier.address);

    // Net freight = 83% of 5 ETH = 4.15 ETH + 0.5 ETH detention = 4.65 ETH
    expect(carrierAfter - carrierBefore).to.equal(ethers.parseEther("4.65"));
  });

  it("Should cancel and refund shipper before dispatch", async function () {
    const settlementId = ethers.keccak256(ethers.toUtf8Bytes("SETTLEMENT_ORDER_CANCEL"));
    const totalAmount = ethers.parseEther("3.0");

    await settlementContract.connect(shipper).createSettlement(
      settlementId,
      carrier.address,
      broker.address,
      insurer.address,
      carbonFund.address,
      taxAuthority.address,
      totalAmount,
      defaultSplits
    );

    await settlementContract.connect(shipper).fundSettlement(settlementId, { value: totalAmount });

    const shipperBefore = await ethers.provider.getBalance(shipper.address);
    await settlementContract.connect(oracle).cancelSettlement(settlementId);
    const shipperAfter = await ethers.provider.getBalance(shipper.address);

    expect(shipperAfter - shipperBefore).to.equal(totalAmount);
    const cancelled = await settlementContract.getSettlement(settlementId);
    expect(cancelled.state).to.equal(6); // Cancelled
  });

  it("Should allow raising and arbitrating a settlement dispute", async function () {
    const settlementId = ethers.keccak256(ethers.toUtf8Bytes("SETTLEMENT_DISPUTE"));
    const totalAmount = ethers.parseEther("4.0");

    await settlementContract.connect(shipper).createSettlement(
      settlementId,
      carrier.address,
      broker.address,
      insurer.address,
      carbonFund.address,
      taxAuthority.address,
      totalAmount,
      defaultSplits
    );

    await settlementContract.connect(shipper).fundSettlement(settlementId, { value: totalAmount });
    await settlementContract.connect(oracle).markDispatched(settlementId);

    await settlementContract.connect(shipper).disputeSettlement(settlementId, "Cargo damaged in transit");
    const disputed = await settlementContract.getSettlement(settlementId);
    expect(disputed.state).to.equal(5); // Disputed

    // Arbitrate: 1 ETH to carrier, 3 ETH refunded to shipper
    const carrierAward = ethers.parseEther("1.0");
    const shipperRefund = ethers.parseEther("3.0");

    const carrierBefore = await ethers.provider.getBalance(carrier.address);
    const shipperBefore = await ethers.provider.getBalance(shipper.address);

    await settlementContract.connect(owner).resolveDispute(settlementId, carrierAward, shipperRefund);

    const carrierAfter = await ethers.provider.getBalance(carrier.address);
    const shipperAfter = await ethers.provider.getBalance(shipper.address);

    expect(carrierAfter - carrierBefore).to.equal(carrierAward);
    expect(shipperAfter - shipperBefore).to.equal(shipperRefund);
  });
});
