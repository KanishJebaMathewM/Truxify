const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AssetProvenance Handoffs", function () {
  it("Should record dynamic chain of custody transitions and track holder sequence", async function () {
    const [owner, carrierA, carrierB] = await ethers.getSigners();
    const AssetProvenance = await ethers.getContractFactory("AssetProvenance");
    const provenance = await AssetProvenance.deploy();

    const cargoHash = ethers.keccak256(ethers.toUtf8Bytes("CARGO_CONTAINER_INDEX_1001"));
    const zkpHash = ethers.keccak256(ethers.toUtf8Bytes("ZK_PROOF_DATA_098"));

    // Hand off custody from owner to carrier A
    await provenance.recordHandoff(cargoHash, carrierA.address, zkpHash);
    
    // Hand off from carrier A to carrier B
    await provenance.connect(carrierA).recordHandoff(cargoHash, carrierB.address, zkpHash);

    const handoffCount = await provenance.getHandoffCount(cargoHash);
    expect(handoffCount).to.equal(2);

    const record = await provenance.provenanceTrail(cargoHash, 1);
    expect(record.currentHolder).to.equal(carrierB.address);
  });
});
