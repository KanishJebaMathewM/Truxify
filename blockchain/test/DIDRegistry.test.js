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