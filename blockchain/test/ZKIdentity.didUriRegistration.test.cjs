const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ZKIdentity DID URI registration", function () {
    async function deployIdentity() {
        const MockVerifier = await ethers.getContractFactory("MockZKIdentityVerifier");
        const verifier = await MockVerifier.deploy();
        await verifier.waitForDeployment();

        const ZKIdentity = await ethers.getContractFactory("ZKIdentity");
        const identity = await ZKIdentity.deploy(verifier.target);
        await identity.waitForDeployment();
        return identity;
    }

    function canonicalDid(address) {
        return `did:truxify:polygon:${address.toLowerCase()}`;
    }

    it("registers the canonical DID URI for the caller", async function () {
        const identity = await deployIdentity();
        const [, user] = await ethers.getSigners();
        const didURI = canonicalDid(user.address);
        const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("credential-root"));

        await expect(identity.connect(user).registerDID(didURI, merkleRoot))
            .to.emit(identity, "DIDRegistered")
            .withArgs(user.address, didURI, merkleRoot);

        const document = await identity.didRegistry(user.address);
        expect(document.didURI).to.equal(didURI);
        expect(await identity.didURIToIdentity(ethers.keccak256(ethers.toUtf8Bytes(didURI))))
            .to.equal(user.address);
    });

    it("rejects a DID URI belonging to another address", async function () {
        const identity = await deployIdentity();
        const [, owner, attacker] = await ethers.getSigners();
        const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("credential-root"));
        const ownerDid = canonicalDid(owner.address);

        await expect(identity.connect(attacker).registerDID(ownerDid, merkleRoot))
            .to.be.revertedWith("DID URI must match caller");
    });

    it("rejects duplicate registration by the same identity", async function () {
        const identity = await deployIdentity();
        const [, user] = await ethers.getSigners();
        const didURI = canonicalDid(user.address);
        const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("credential-root"));

        await identity.connect(user).registerDID(didURI, merkleRoot);

        await expect(identity.connect(user).registerDID(didURI, merkleRoot))
            .to.be.revertedWithCustomError(identity, "DIDAlreadyExists");
    });

    it("rejects empty DID URIs", async function () {
        const identity = await deployIdentity();
        const [, user] = await ethers.getSigners();
        const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("credential-root"));

        await expect(identity.connect(user).registerDID("", merkleRoot))
            .to.be.revertedWith("DID URI required");
    });
});
