const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SubstrateBridge Cross-Chain Engine", function () {
  it("Should relay XCM message transfers to target Parachain ID", async function () {
    const [owner, relayer] = await ethers.getSigners();
    const SubstrateBridge = await ethers.getContractFactory("SubstrateBridge");
    const bridge = await SubstrateBridge.deploy();

    const msgHash = ethers.keccak256(ethers.toUtf8Bytes("XCM_TX_BILL_OF_LADING_101"));
    
    // Mock 65-byte ECDSA signature
    const mockSignature = ethers.concat([
      ethers.toBeHex(1, 32),
      ethers.toBeHex(2, 32),
      ethers.toBeHex(27, 1)
    ]);

    const tx = await bridge.relayXcmMessage(msgHash, 2000, relayer.address, 500, mockSignature);
    await tx.wait();

    expect(await bridge.processedMessages(msgHash)).to.equal(true);
  });
});
