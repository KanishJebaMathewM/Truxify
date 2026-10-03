import assert from "node:assert/strict";
import hre from "hardhat";
const { ethers } = hre;

async function assertRejectsWith(promise, message) {
  await assert.rejects(promise, error => error.message.includes(message));
}

describe("DIDRegistry issuer authorization", function () {
  async function deployRegistry() {
    const [owner, issuer, attacker, subject] = await ethers.getSigners();
    const DIDRegistry = await ethers.getContractFactory("DIDRegistry");
    const registry = await DIDRegistry.deploy();
    await registry.waitForDeployment();
    return { registry, owner, issuer, attacker, subject };
  }

  it("rejects issueCredential from an address the owner never authorized", async function () {
    const { registry, attacker, subject } = await deployRegistry();

    await assertRejectsWith(
      registry.connect(attacker).issueCredential(
        subject.address,
        "KYC",
        ethers.ZeroHash,
        (await ethers.provider.getBlock("latest")).timestamp + 3600,
        ethers.ZeroHash
      ),
      "Issuer not authorized for credential type"
    );
  });

  it("only the owner can grant issuer authorization", async function () {
    const { registry, attacker, issuer } = await deployRegistry();

    await assertRejectsWith(
      registry.connect(attacker).setIssuerAuthorization(issuer.address, "KYC", true),
      "OwnableUnauthorizedAccount"
    );
  });

  it("lets an authorized issuer issue a credential of that type, and verifyCredential reports it valid", async function () {
    const { registry, owner, issuer, subject } = await deployRegistry();

    await registry.connect(owner).setIssuerAuthorization(issuer.address, "KYC", true);

    const validUntil = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    const tx = await registry.connect(issuer).issueCredential(
      subject.address,
      "KYC",
      ethers.ZeroHash,
      validUntil,
      ethers.ZeroHash
    );
    const receipt = await tx.wait();
    const event = receipt.logs
      .map(log => { try { return registry.interface.parseLog(log); } catch { return null; } })
      .find(parsed => parsed && parsed.name === "CredentialIssued");
    const credentialId = event.args[0];

    assert.equal(await registry.verifyCredential(credentialId), true);
  });

  it("authorization is scoped to the credential type — an issuer authorized for KYC cannot mint a DriverLicense credential", async function () {
    const { registry, owner, issuer, subject } = await deployRegistry();

    await registry.connect(owner).setIssuerAuthorization(issuer.address, "KYC", true);

    await assertRejectsWith(
      registry.connect(issuer).issueCredential(
        subject.address,
        "DriverLicense",
        ethers.ZeroHash,
        (await ethers.provider.getBlock("latest")).timestamp + 3600,
        ethers.ZeroHash
      ),
      "Issuer not authorized for credential type"
    );
  });

  it("verifyCredential turns false once the issuer's authorization is revoked, even if the credential itself was never revoked", async function () {
    const { registry, owner, issuer, subject } = await deployRegistry();

    await registry.connect(owner).setIssuerAuthorization(issuer.address, "KYC", true);
    const validUntil = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    const tx = await registry.connect(issuer).issueCredential(
      subject.address, "KYC", ethers.ZeroHash, validUntil, ethers.ZeroHash
    );
    const receipt = await tx.wait();
    const event = receipt.logs
      .map(log => { try { return registry.interface.parseLog(log); } catch { return null; } })
      .find(parsed => parsed && parsed.name === "CredentialIssued");
    const credentialId = event.args[0];

    assert.equal(await registry.verifyCredential(credentialId), true);

    await registry.connect(owner).setIssuerAuthorization(issuer.address, "KYC", false);

    assert.equal(await registry.verifyCredential(credentialId), false);
  });
});

describe("DIDRegistry ownership and credential ID derivation", function () {
  async function deployRegistry() {
    const [owner, issuer, attacker, subject, user] = await ethers.getSigners();
    const DIDRegistry = await ethers.getContractFactory("DIDRegistry");
    const registry = await DIDRegistry.deploy();
    await registry.waitForDeployment();
    return { registry, owner, issuer, attacker, subject, user };
  }

  it("A. Direct DID creation: a user creating their own DID becomes owner and seals initialization", async function () {
    const { registry, owner, user } = await deployRegistry();
    const did = "did:truxify:direct-user-1";

    const tx = await registry.connect(user).createDID(did);
    await tx.wait();

    const [didOwner, didString, isActive] = await registry.getDID(did);
    assert.equal(didOwner, user.address);
    assert.equal(didString, did);
    assert.equal(isActive, true);
    assert.equal(await registry.didInitialized(did), true);

    const userDIDs = await registry.getDIDsByOwner(user.address);
    assert.equal(userDIDs.includes(did), true);

    // Relayer cannot run configureDIDDuringCreation on a direct user DID
    await assertRejectsWith(
      registry.connect(owner).configureDIDDuringCreation(did, [], []),
      "DID already initialized"
    );
  });

  it("B. Relayed DID creation & initial configuration: relayer can create DID for user and configure it once", async function () {
    const { registry, owner, user } = await deployRegistry();
    const did = "did:truxify:relayed-user-1";

    const tx = await registry.connect(owner).createDIDFor(did, user.address);
    await tx.wait();

    const [didOwner, didString, isActive] = await registry.getDID(did);
    assert.equal(didOwner, user.address);
    assert.equal(didString, did);
    assert.equal(isActive, true);
    assert.equal(await registry.didInitialized(did), false);

    const initialEndpoints = [
      { id: "identity", endpointType: "IdentityService", serviceEndpoint: "https://truxify.com/api/did/identity", description: "Main identity" },
      { id: "credentials", endpointType: "CredentialService", serviceEndpoint: "https://truxify.com/api/did/credentials", description: "Credential service" }
    ];
    const initialMethods = [
      { id: "key-1", keyType: "RsaVerificationKey2018", controller: did, publicKeyMultibase: "z6Mku...hash" }
    ];

    const configTx = await registry.connect(owner).configureDIDDuringCreation(did, initialEndpoints, initialMethods);
    await configTx.wait();

    assert.equal(await registry.didInitialized(did), true);

    const endpoints = await registry.getServiceEndpoints(did);
    assert.equal(endpoints.length, 2);
    assert.equal(endpoints[0].id, "identity");

    const methods = await registry.getVerificationMethods(did);
    assert.equal(methods.length, 1);
    assert.equal(methods[0].id, "key-1");
  });

  it("C. Relayer cannot modify service endpoints or verification methods after initialization", async function () {
    const { registry, owner, user } = await deployRegistry();
    const did = "did:truxify:relayer-lockout-1";

    await (await registry.connect(owner).createDIDFor(did, user.address)).wait();
    await (await registry.connect(owner).configureDIDDuringCreation(did, [], [])).wait();

    // Relayer cannot call addServiceEndpoint
    await assertRejectsWith(
      registry.connect(owner).addServiceEndpoint(did, "malicious-ep", "Type", "https://bad.com", "Bad"),
      "Not owner"
    );

    // Relayer cannot call addVerificationMethod
    await assertRejectsWith(
      registry.connect(owner).addVerificationMethod(did, "malicious-key", "Ed25519", did, "zBadKey"),
      "Not owner"
    );

    // Relayer cannot configure again
    await assertRejectsWith(
      registry.connect(owner).configureDIDDuringCreation(did, [], []),
      "DID already initialized"
    );
  });

  it("D. Unauthorized create-for-user: a random third party cannot create a DID for another address", async function () {
    const { registry, attacker, user } = await deployRegistry();
    const did = "did:truxify:attacker-did-1";

    await assertRejectsWith(
      registry.connect(attacker).createDIDFor(did, user.address),
      "OwnableUnauthorizedAccount"
    );
  });

  it("E. Owner mutation: the true DID owner can update, deactivate, add endpoint, and add verification method", async function () {
    const { registry, owner, user } = await deployRegistry();
    const did = "did:truxify:owner-mutation-1";

    await (await registry.connect(owner).createDIDFor(did, user.address)).wait();

    // User adds service endpoint
    await (await registry.connect(user).addServiceEndpoint(did, "endpoint-1", "IdentityService", "https://truxify.com/id", "Primary")).wait();
    const endpoints = await registry.getServiceEndpoints(did);
    assert.equal(endpoints.length, 1);
    assert.equal(endpoints[0].id, "endpoint-1");

    // User adds verification method
    await (await registry.connect(user).addVerificationMethod(did, "key-1", "Ed25519", did, "z6Mku...hash")).wait();
    const methods = await registry.getVerificationMethods(did);
    assert.equal(methods.length, 1);
    assert.equal(methods[0].id, "key-1");

    // User updates DID
    const dummyHash = ethers.keccak256(ethers.toUtf8Bytes("newEndpoint"));
    await (await registry.connect(user).updateDID(did, [dummyHash])).wait();

    // User deactivates DID
    await (await registry.connect(user).deactivateDID(did)).wait();
    assert.equal(await registry.isDIDActive(did), false);
  });

  it("F. Unauthorized mutation: a random third party cannot perform mutations or configuration", async function () {
    const { registry, owner, user, attacker } = await deployRegistry();
    const did = "did:truxify:unauthorized-mutation-1";

    await (await registry.connect(owner).createDIDFor(did, user.address)).wait();

    await assertRejectsWith(
      registry.connect(attacker).configureDIDDuringCreation(did, [], []),
      "OwnableUnauthorizedAccount"
    );

    await assertRejectsWith(
      registry.connect(attacker).addServiceEndpoint(did, "endpoint-bad", "Type", "https://bad.com", "Bad"),
      "Not owner"
    );

    await assertRejectsWith(
      registry.connect(attacker).addVerificationMethod(did, "key-bad", "Ed25519", did, "z6Mku...bad"),
      "Not owner"
    );

    await assertRejectsWith(
      registry.connect(attacker).updateDID(did, []),
      "Not owner"
    );

    await assertRejectsWith(
      registry.connect(attacker).deactivateDID(did),
      "Not owner"
    );
  });

  it("G. Credential ID: emitted event credentialId matches stored credential", async function () {
    const { registry, owner, issuer, subject } = await deployRegistry();
    await registry.connect(owner).setIssuerAuthorization(issuer.address, "KYC", true);

    const validUntil = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    const tx = await registry.connect(issuer).issueCredential(
      subject.address,
      "KYC",
      ethers.ZeroHash,
      validUntil,
      ethers.ZeroHash
    );
    const receipt = await tx.wait();
    const event = receipt.logs
      .map(log => { try { return registry.interface.parseLog(log); } catch { return null; } })
      .find(parsed => parsed && parsed.name === "CredentialIssued");
    const eventCredentialId = event.args[0];

    const cred = await registry.getCredential(eventCredentialId);
    assert.equal(cred.id, eventCredentialId);
    assert.equal(cred.issuer, issuer.address);
    assert.equal(cred.subject, subject.address);
    assert.equal(cred.credentialType, "KYC");
  });

  it("H. Credential nonce: multiple credentials from the same issuer produce distinct IDs", async function () {
    const { registry, owner, issuer, subject } = await deployRegistry();
    await registry.connect(owner).setIssuerAuthorization(issuer.address, "KYC", true);

    const validUntil = (await ethers.provider.getBlock("latest")).timestamp + 3600;

    const tx1 = await registry.connect(issuer).issueCredential(
      subject.address, "KYC", ethers.ZeroHash, validUntil, ethers.ZeroHash
    );
    const receipt1 = await tx1.wait();
    const id1 = receipt1.logs
      .map(log => { try { return registry.interface.parseLog(log); } catch { return null; } })
      .find(parsed => parsed && parsed.name === "CredentialIssued").args[0];

    const tx2 = await registry.connect(issuer).issueCredential(
      subject.address, "KYC", ethers.ZeroHash, validUntil, ethers.ZeroHash
    );
    const receipt2 = await tx2.wait();
    const id2 = receipt2.logs
      .map(log => { try { return registry.interface.parseLog(log); } catch { return null; } })
      .find(parsed => parsed && parsed.name === "CredentialIssued").args[0];

    assert.notEqual(id1, id2);
  });

  it("I. Credential ID fallback safety: unverified or mismatched credential IDs are rejected", async function () {
    const { registry, owner, issuer, subject } = await deployRegistry();
    await registry.connect(owner).setIssuerAuthorization(issuer.address, "KYC", true);

    const validUntil = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    const proofHash = ethers.keccak256(ethers.toUtf8Bytes("realProof"));
    const fakeProofHash = ethers.keccak256(ethers.toUtf8Bytes("fakeProof"));

    const tx = await registry.connect(issuer).issueCredential(
      subject.address, "KYC", ethers.ZeroHash, validUntil, proofHash
    );
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt.blockNumber);
    const currentNonce = await registry.issuerNonces(issuer.address);
    const actualNonce = currentNonce - 1n;

    // Correct derivation with 5 fields
    const validCandidateId = ethers.keccak256(
      ethers.solidityPacked(
        ["uint256", "address", "address", "string", "uint256"],
        [block.timestamp, issuer.address, subject.address, "KYC", actualNonce]
      )
    );
    const cred = await registry.getCredential(validCandidateId);
    assert.equal(cred.proofHash, proofHash);

    // Fallback logic verification: candidate with wrong nonce or fake proofHash must NOT be verified
    const wrongNonceCandidateId = ethers.keccak256(
      ethers.solidityPacked(
        ["uint256", "address", "address", "string", "uint256"],
        [block.timestamp, issuer.address, subject.address, "KYC", actualNonce + 99n]
      )
    );
    const badCred = await registry.getCredential(wrongNonceCandidateId);
    assert.equal(badCred.issuer, ethers.ZeroAddress);
    assert.notEqual(badCred.proofHash, proofHash);
  });
});