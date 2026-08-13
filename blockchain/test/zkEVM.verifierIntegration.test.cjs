const assert = require("node:assert/strict");
const { ethers } = require("hardhat");

async function assertRejectsWith(promise, message) {
  await assert.rejects(promise, (error) => error.message.includes(message));
}

function encodeProof() {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256[2]", "uint256[2][2]", "uint256[2]", "uint256[2]"],
    [[1, 2], [[1, 2], [1, 2]], [1, 2], [1, 1]]
  );
}

describe("zkEVM verifier integration", function () {
  it("reverts clearly when no verifier is configured (issue #10798)", async function () {
    const zkEVM = await (await ethers.getContractFactory("zkEVM")).deploy(ethers.ZeroAddress);
    await zkEVM.waitForDeployment();
    const [user] = await ethers.getSigners();

    await zkEVM.connect(user).depositToL2({ value: ethers.parseEther("1") });
    await assertRejectsWith(
      zkEVM.connect(user).withdrawFromL2(ethers.parseEther("0.5"), encodeProof()),
      "zkEVM: verifier not configured"
    );
  });

  it("reverts clearly when executing a batch without a configured verifier (issue #10798)", async function () {
    const zkEVM = await (await ethers.getContractFactory("zkEVM")).deploy(ethers.ZeroAddress);
    await zkEVM.waitForDeployment();

    await assertRejectsWith(
      zkEVM.executeBatch(["0x1234"], encodeProof()),
      "zkEVM: verifier not configured"
    );
  });

  it("processes withdrawals once a real verifier is wired (issue #10798)", async function () {
    const mockVerifier = await (await ethers.getContractFactory("MockZkEVMVerifier")).deploy();
    await mockVerifier.waitForDeployment();
    const zkEVM = await (await ethers.getContractFactory("zkEVM")).deploy(await mockVerifier.getAddress());
    await zkEVM.waitForDeployment();
    const [user] = await ethers.getSigners();

    await zkEVM.connect(user).depositToL2({ value: ethers.parseEther("1") });
    const before = await ethers.provider.getBalance(user.address);

    const tx = await zkEVM.connect(user).withdrawFromL2(ethers.parseEther("0.5"), encodeProof());
    await tx.wait();

    const after = await ethers.provider.getBalance(user.address);
    assert.ok(after > before, "user must receive funds through the intended path");
    assert.equal(await zkEVM.getBalance(user.address), ethers.parseEther("0.5"));
  });

  it("can switch to a real verifier with setVerifier (issue #10798)", async function () {
    const zkEVM = await (await ethers.getContractFactory("zkEVM")).deploy(ethers.ZeroAddress);
    await zkEVM.waitForDeployment();
    const mockVerifier = await (await ethers.getContractFactory("MockZkEVMVerifier")).deploy();
    await mockVerifier.waitForDeployment();
    const [user] = await ethers.getSigners();

    await zkEVM.connect(user).depositToL2({ value: ethers.parseEther("1") });
    await assertRejectsWith(
      zkEVM.connect(user).withdrawFromL2(ethers.parseEther("0.5"), encodeProof()),
      "zkEVM: verifier not configured"
    );

    await zkEVM.setVerifier(await mockVerifier.getAddress());
    await zkEVM.connect(user).withdrawFromL2(ethers.parseEther("0.5"), encodeProof());
    assert.equal(await zkEVM.getBalance(user.address), ethers.parseEther("0.5"));
  });

  it("reverts loudly if the configured verifier still fails closed (issue #10798)", async function () {
    const stub = await (await ethers.getContractFactory("Verifier")).deploy();
    await stub.waitForDeployment();
    const zkEVM = await (await ethers.getContractFactory("zkEVM")).deploy(await stub.getAddress());
    await zkEVM.waitForDeployment();
    const [user] = await ethers.getSigners();

    await zkEVM.connect(user).depositToL2({ value: ethers.parseEther("1") });
    await assertRejectsWith(
      zkEVM.connect(user).withdrawFromL2(ethers.parseEther("0.5"), encodeProof()),
      "Invalid proof"
    );
  });
});
