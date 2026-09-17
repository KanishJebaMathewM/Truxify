const { expect } = require("chai");
const { ethers } = require("hardhat");

function encodeProof(recipient, amount) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256[2]", "uint256[2][2]", "uint256[2]", "uint256[2]"],
    [
      [1n, 2n],
      [
        [3n, 4n],
        [5n, 6n],
      ],
      [7n, 8n],
      [BigInt(recipient), amount],
    ]
  );
}

describe("zkEVM withdrawal proof binding", function () {
  async function deployFixture() {
    const [owner, withdrawer, otherUser] = await ethers.getSigners();
    const Verifier = await ethers.getContractFactory("zkEVMTestVerifier");
    const verifier = await Verifier.deploy();

    const ZkEVM = await ethers.getContractFactory("zkEVM");
    const zkEVM = await ZkEVM.deploy(await verifier.getAddress());

    return { owner, withdrawer, otherUser, zkEVM };
  }

  it("rejects a valid proof when the withdrawal amount is changed", async function () {
    const { withdrawer, zkEVM } = await deployFixture();
    const depositedAmount = ethers.parseEther("2");
    const provedAmount = ethers.parseEther("1");
    const requestedAmount = ethers.parseEther("1.5");

    await zkEVM.connect(withdrawer).depositToL2({ value: depositedAmount });

    const proof = encodeProof(withdrawer.address, provedAmount);

    await expect(
      zkEVM.connect(withdrawer).withdrawFromL2(requestedAmount, proof)
    ).to.be.revertedWith("Proof amount mismatch");

    expect(await zkEVM.getBalance(withdrawer.address)).to.equal(depositedAmount);
  });

  it("rejects a proof generated for a different recipient", async function () {
    const { withdrawer, otherUser, zkEVM } = await deployFixture();
    const amount = ethers.parseEther("1");

    await zkEVM.connect(otherUser).depositToL2({ value: amount });

    const proof = encodeProof(withdrawer.address, amount);

    await expect(
      zkEVM.connect(otherUser).withdrawFromL2(amount, proof)
    ).to.be.revertedWith("Proof recipient mismatch");

    expect(await zkEVM.getBalance(otherUser.address)).to.equal(amount);
  });

  it("allows a withdrawal when proof recipient and amount match the call", async function () {
    const { withdrawer, zkEVM } = await deployFixture();
    const amount = ethers.parseEther("1");

    await zkEVM.connect(withdrawer).depositToL2({ value: amount });

    const proof = encodeProof(withdrawer.address, amount);
    await expect(
      zkEVM.connect(withdrawer).withdrawFromL2(amount, proof)
    ).to.emit(zkEVM, "BridgeWithdraw")
      .withArgs(withdrawer.address, amount);

    expect(await zkEVM.getBalance(withdrawer.address)).to.equal(0n);
  });
});