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

  it("Should reject an unauthorized address seeding the first handoff", async function () {
    const [owner, attacker, carrierA] = await ethers.getSigners();
    const AssetProvenance = await ethers.getContractFactory("AssetProvenance");
    const provenance = await AssetProvenance.deploy();

    const cargoHash = ethers.keccak256(ethers.toUtf8Bytes("CARGO_CONTAINER_INDEX_2002"));
    const zkpHash = ethers.keccak256(ethers.toUtf8Bytes("ZK_PROOF_DATA_200"));

    await expect(
      provenance.connect(attacker).recordHandoff(cargoHash, carrierA.address, zkpHash)
    ).to.be.revertedWith("Only owner can seed initial custody");
  });

  it("Should not mark a record verified when no proof hash is supplied", async function () {
    const [owner, carrierA] = await ethers.getSigners();
    const AssetProvenance = await ethers.getContractFactory("AssetProvenance");
    const provenance = await AssetProvenance.deploy();

    const cargoHash = ethers.keccak256(ethers.toUtf8Bytes("CARGO_CONTAINER_INDEX_3003"));

    await provenance.recordHandoff(cargoHash, carrierA.address, ethers.ZeroHash);

    const record = await provenance.provenanceTrail(cargoHash, 0);
    expect(record.verified).to.equal(false);
  });

  it("Should mark a record verified when a proof hash is supplied", async function () {
    const [owner, carrierA] = await ethers.getSigners();
    const AssetProvenance = await ethers.getContractFactory("AssetProvenance");
    const provenance = await AssetProvenance.deploy();

    const cargoHash = ethers.keccak256(ethers.toUtf8Bytes("CARGO_CONTAINER_INDEX_4004"));
    const zkpHash = ethers.keccak256(ethers.toUtf8Bytes("ZK_PROOF_DATA_400"));

    await provenance.recordHandoff(cargoHash, carrierA.address, zkpHash);

    const record = await provenance.provenanceTrail(cargoHash, 0);
    expect(record.verified).to.equal(true);
  });
});

  it("Should reject an unauthenticated first handoff from a non-owner", async function () {
    const [owner, stranger] = await ethers.getSigners();
    const AssetProvenance = await ethers.getContractFactory("AssetProvenance");
    const provenance = await AssetProvenance.deploy();

    const cargoHash = ethers.keccak256(ethers.toUtf8Bytes("CARGO_CONTAINER_INDEX_2002"));
    const zkpHash = ethers.keccak256(ethers.toUtf8Bytes("ZK_PROOF_DATA_200"));

    await expect(
      provenance.connect(stranger).recordHandoff(cargoHash, stranger.address, zkpHash)
    ).to.be.revertedWith("Only the asset owner can open the provenance trail");
  });

  it("Should allow the owner to open the trail and not hard-code verified true", async function () {
    const [owner, carrierA] = await ethers.getSigners();
    const AssetProvenance = await ethers.getContractFactory("AssetProvenance");
    const provenance = await AssetProvenance.deploy();

    const cargoHash = ethers.keccak256(ethers.toUtf8Bytes("CARGO_CONTAINER_INDEX_3003"));

    // A handoff with an empty proof hash must be rejected and not marked verified.
    await expect(
      provenance.recordHandoff(cargoHash, carrierA.address, ethers.ZeroHash)
    ).to.be.revertedWith("A non-empty ZK proof hash is required to verify the handoff");

    // A genuine proof hash yields a record whose verified flag reflects the proof.
    const zkpHash = ethers.keccak256(ethers.toUtf8Bytes("ZK_PROOF_DATA_300"));
    await provenance.recordHandoff(cargoHash, carrierA.address, zkpHash);

    const record = await provenance.provenanceTrail(cargoHash, 0);
    expect(record.currentHolder).to.equal(carrierA.address);
    expect(record.verified).to.equal(true);
  });
});
