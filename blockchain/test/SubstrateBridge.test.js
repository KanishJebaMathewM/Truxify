const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SubstrateBridge Cross-Chain Engine", function () {
  it("Should relay XCM message transfers to target Parachain ID", async function () {
    const [owner, relayer] = await ethers.getSigners();
    const SubstrateBridge = await ethers.getContractFactory("SubstrateBridge");
    const bridge = await SubstrateBridge.deploy();

    const msgHash = ethers.keccak256(ethers.toUtf8Bytes("XCM_TX_BILL_OF_LADING_101"));

    // Owner-signed EIP-191 signature over the bound message digest:
    // keccak256(abi.encodePacked(messageHash, destParachainId, recipient, amount)) (issue #11988).
    const digest = ethers.solidityPackedKeccak256(
      ["bytes32", "uint32", "address", "uint256"],
      [msgHash, 2000, relayer.address, 500]
    );
    const signature = await owner.signMessage(ethers.getBytes(digest));

    const tx = await bridge.relayXcmMessage(msgHash, 2000, relayer.address, 500, signature);
    await tx.wait();

    expect(await bridge.processedMessages(msgHash)).to.equal(true);
  });

  it("Should reject a relay when the signature is not from the owner", async function () {
    const [owner, relayer, attacker] = await ethers.getSigners();
    const SubstrateBridge = await ethers.getContractFactory("SubstrateBridge");
    const bridge = await SubstrateBridge.deploy();

    const msgHash = ethers.keccak256(ethers.toUtf8Bytes("XCM_TX_BILL_OF_LADING_101"));

    const forgedSignature = await attacker.signMessage(ethers.getBytes(msgHash));

    await expect(
      bridge.relayXcmMessage(msgHash, 2000, relayer.address, 500, forgedSignature)
    ).to.be.revertedWith("Invalid bridge transaction signature");
  });

  it("Should reject a relay from a non-owner caller", async function () {
    const [owner, relayer, attacker] = await ethers.getSigners();
    const SubstrateBridge = await ethers.getContractFactory("SubstrateBridge");
    const bridge = await SubstrateBridge.deploy();

    const msgHash = ethers.keccak256(ethers.toUtf8Bytes("XCM_TX_BILL_OF_LADING_101"));

    const signature = await owner.signMessage(ethers.getBytes(msgHash));

    await expect(
      bridge.connect(attacker).relayXcmMessage(msgHash, 2000, relayer.address, 500, signature)
    ).to.be.revertedWithCustomError(bridge, "OwnableUnauthorizedAccount");
  });
});
