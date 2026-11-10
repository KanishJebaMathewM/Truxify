const { expect } = require("chai");
const { ethers } = require("hardhat");

// The 4-input Groth16 verifier is a placeholder that fails closed. The
// authorized path below exercises every guard that precedes the verifier call
// (nonzero proof, proof bound to driver) and asserts the call reverts. The
// revert reason is deliberately NOT asserted: the placeholder's dedicated
// not-implemented revert will be replaced when the real verifier is
// generated, and this test must remain valid as invalid-proof rejection
// coverage at that point.
describe("DriverQualificationVerifier fail-closed verifier", function () {
  it("rejects an authorized verifyAndAttest with a nonzero, driver-bound proof", async function () {
    const [admin, driver] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("DriverQualificationVerifier");
    const verifier = await Factory.deploy();

    const a = [1n, 2n]; // nonzero proof
    const b = [
      [1n, 2n],
      [3n, 4n],
    ];
    const c = [1n, 2n];
    const input = [
      BigInt(driver.address), // proof bound to the driver
      1n,
      2n,
      3n,
    ];
    const validUntil = Math.floor(Date.now() / 1000 / 86400) + 365;

    await expect(
      verifier.connect(admin).verifyAndAttest(a, b, c, input, driver.address, validUntil)
    ).to.be.reverted;
  });
});
