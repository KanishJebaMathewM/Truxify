import assert from "node:assert/strict";
import hre from "hardhat";
const { ethers } = hre;

async function assertRejectsWith(promise, message) {
  await assert.rejects(promise, error => error.message.includes(message));
}

describe("IdentityWallet credential scoping", function () {
  async function deployWallet() {
    const [owner, alice, bob] = await ethers.getSigners();
    const IdentityWallet = await ethers.getContractFactory("IdentityWallet");
    const wallet = await IdentityWallet.deploy();
    await wallet.waitForDeployment();
    return { wallet, owner, alice, bob };
  }

  async function createWallet(wallet, signer) {
    const did = `did:example:${signer.address.toLowerCase()}`;
    const tx = await wallet.connect(signer).createWallet(did);
    await tx.wait();
    return did;
  }

  const credentialId = ethers.keccak256(ethers.toUtf8Bytes("KYCCredential#12345"));

  // addCredential requires an EIP-191 issuer signature over
  // keccak256(abi.encodePacked(block.chainid, address(this), credentialId, walletOwner))
  // from a trusted issuer. The deployer is trusted by default (see constructor).
  async function signCredential(issuer, credentialId, walletOwner, wallet) {
    const network = await ethers.provider.getNetwork();
    const walletAddress = await wallet.getAddress();
    const hash = ethers.solidityPackedKeccak256(
      ["uint256", "address", "bytes32", "address"],
      [network.chainId, walletAddress, credentialId, walletOwner]
    );
    return issuer.signMessage(ethers.getBytes(hash));
  }

  it("lets the same credentialId be stored in two different wallets", async function () {
    const { wallet, owner, alice, bob } = await deployWallet();
    await createWallet(wallet, alice);
    await createWallet(wallet, bob);

    await (await wallet.connect(alice).addCredential(credentialId, await signCredential(owner, credentialId, alice.address, wallet))).wait();
    await (await wallet.connect(bob).addCredential(credentialId, await signCredential(owner, credentialId, bob.address, wallet))).wait();

    assert.equal(await wallet.hasCredential(alice.address, credentialId), true);
    assert.equal(await wallet.hasCredential(bob.address, credentialId), true);
  });

  it("still reverts when the same wallet tries to add a credential twice", async function () {
    const { wallet, owner, alice } = await deployWallet();
    await createWallet(wallet, alice);

    await (await wallet.connect(alice).addCredential(credentialId, await signCredential(owner, credentialId, alice.address, wallet))).wait();

    await assertRejectsWith(
      wallet.connect(alice).addCredential(credentialId, await signCredential(owner, credentialId, alice.address, wallet)),
      "Credential already in wallet"
    );
  });

  it("removeCredential only clears the caller's own wallet, not other wallets holding the same credential", async function () {
    const { wallet, owner, alice, bob } = await deployWallet();
    await createWallet(wallet, alice);
    await createWallet(wallet, bob);
    await (await wallet.connect(alice).addCredential(credentialId, await signCredential(owner, credentialId, alice.address, wallet))).wait();
    await (await wallet.connect(bob).addCredential(credentialId, await signCredential(owner, credentialId, bob.address, wallet))).wait();

    await (await wallet.connect(alice).removeCredential(credentialId)).wait();

    assert.equal(await wallet.hasCredential(alice.address, credentialId), false);
    assert.equal(await wallet.hasCredential(bob.address, credentialId), true);

    const bobCredentials = await wallet.getCredentials(bob.address);
    assert.equal(bobCredentials.length, 1);
    assert.equal(bobCredentials[0], credentialId);
  });

  it("hasCredential returns the per-owner answer and ignores nothing", async function () {
    const { wallet, owner, alice, bob } = await deployWallet();
    await createWallet(wallet, alice);
    await createWallet(wallet, bob);

    await (await wallet.connect(alice).addCredential(credentialId, await signCredential(owner, credentialId, alice.address, wallet))).wait();

    assert.equal(await wallet.hasCredential(alice.address, credentialId), true);
    assert.equal(await wallet.hasCredential(bob.address, credentialId), false);
  });

  it("removeCredential reverts for a caller that does not hold the credential", async function () {
    const { wallet, owner, alice, bob } = await deployWallet();
    await createWallet(wallet, alice);
    await createWallet(wallet, bob);
    await (await wallet.connect(alice).addCredential(credentialId, await signCredential(owner, credentialId, alice.address, wallet))).wait();

    await assertRejectsWith(
      wallet.connect(bob).removeCredential(credentialId),
      "Credential not in wallet"
    );
  });

  it("keeps the wallet credentials array consistent across add/remove", async function () {
    const { wallet, owner, alice } = await deployWallet();
    await createWallet(wallet, alice);

    const second = ethers.keccak256(ethers.toUtf8Bytes("DrivingLicence#67890"));
    await (await wallet.connect(alice).addCredential(credentialId, await signCredential(owner, credentialId, alice.address, wallet))).wait();
    await (await wallet.connect(alice).addCredential(second, await signCredential(owner, second, alice.address, wallet))).wait();

    assert.deepEqual([...await wallet.getCredentials(alice.address)], [credentialId, second]);

    await (await wallet.connect(alice).removeCredential(credentialId)).wait();

    assert.deepEqual([...await wallet.getCredentials(alice.address)], [second]);
    assert.equal(await wallet.hasCredential(alice.address, second), true);
    assert.equal(await wallet.hasCredential(alice.address, credentialId), false);
  });

  it("rejects cross-deployment replay of a credential signature", async function () {
    const { wallet: walletA, owner, alice } = await deployWallet();
    const { wallet: walletB } = await deployWallet();
    await createWallet(walletA, alice);
    await createWallet(walletB, alice);

    const sigA = await signCredential(owner, credentialId, alice.address, walletA);

    await assertRejectsWith(
      walletB.connect(alice).addCredential(credentialId, sigA),
      "Unissued or untrusted credential signature"
    );
  });
});
