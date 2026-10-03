const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ZKIdentity nullifier lifecycle", function () {
    async function deployIdentity() {
        const Verifier = await ethers.getContractFactory("MockZKIdentityVerifier");
        const verifier = await Verifier.deploy();
        await verifier.waitForDeployment();

        const ZKIdentity = await ethers.getContractFactory("ZKIdentity");
        const identity = await ZKIdentity.deploy(await verifier.getAddress());
        await identity.waitForDeployment();
        return identity;
    }

    const proof = ethers.toUtf8Bytes("valid-proof");
    const invalidProof = ethers.toUtf8Bytes("wrong-proof");

    it("keeps credential revocation separate from nullifier usage", async function () {
        const identity = await deployIdentity();
        const [owner, user] = await ethers.getSigners();
        const credentialRoot = ethers.keccak256(ethers.toUtf8Bytes("credential-root"));
        const nullifier = ethers.keccak256(ethers.toUtf8Bytes("one-time-nullifier"));

        await identity.connect(user).registerDID("did:truxify:test", credentialRoot);
        expect(await identity.verifyZkProof(user.address, proof, [], nullifier)).to.equal(true);
        expect(await identity.usedNullifiers(nullifier)).to.equal(false);

        await expect(identity.connect(owner).revokeCredential(nullifier))
            .to.emit(identity, "CredentialRevoked");

        expect(await identity.verifyZkProof(user.address, proof, [], nullifier)).to.equal(false);
        expect(await identity.usedNullifiers(nullifier)).to.equal(false);
    });

    it("consumes a valid nullifier exactly once", async function () {
        const identity = await deployIdentity();
        const [, user] = await ethers.getSigners();
        const credentialRoot = ethers.keccak256(ethers.toUtf8Bytes("credential-root"));
        const nullifier = ethers.keccak256(ethers.toUtf8Bytes("one-time-nullifier"));

        await identity.connect(user).registerDID("did:truxify:test", credentialRoot);
        expect(await identity.verifyZkProof(user.address, proof, [], nullifier)).to.equal(true);
        expect(await identity.usedNullifiers(nullifier)).to.equal(false);
        expect(await identity.spentNullifiers(nullifier)).to.equal(false);

        await expect(identity.connect(user).verifyAndConsumeZkProof(user.address, proof, [], nullifier))
            .to.emit(identity, "NullifierConsumed")
            .withArgs(nullifier);

        expect(await identity.usedNullifiers(nullifier)).to.equal(true);
        expect(await identity.spentNullifiers(nullifier)).to.equal(true);
        expect(await identity.verifyZkProof(user.address, proof, [], nullifier)).to.equal(false);

        await expect(
            identity.connect(user).verifyAndConsumeZkProof(user.address, proof, [], nullifier)
        ).to.be.revertedWith("ZKIdentity: nullifier already used");
    });

    it("does not consume an invalid proof nullifier", async function () {
        const identity = await deployIdentity();
        const [, user] = await ethers.getSigners();
        const credentialRoot = ethers.keccak256(ethers.toUtf8Bytes("credential-root"));
        const nullifier = ethers.keccak256(ethers.toUtf8Bytes("one-time-nullifier"));

        await identity.connect(user).registerDID("did:truxify:test", credentialRoot);

        await expect(
            identity.connect(user).verifyAndConsumeZkProof(user.address, invalidProof, [], nullifier)
        ).to.be.revertedWith("ZKIdentity: invalid proof");

        expect(await identity.usedNullifiers(nullifier)).to.equal(false);
        expect(await identity.spentNullifiers(nullifier)).to.equal(false);
        expect(await identity.verifyZkProof(user.address, invalidProof, [], nullifier)).to.equal(false);
    });
});
