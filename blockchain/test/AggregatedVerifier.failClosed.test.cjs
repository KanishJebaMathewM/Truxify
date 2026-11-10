const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('AggregatedVerifier fail-closed placeholder', function () {
  let verifier;
  let other;
  const commitment = ethers.keccak256(ethers.toUtf8Bytes('unverified batch'));

  beforeEach(async function () {
    [, other] = await ethers.getSigners();
    verifier = await (await ethers.getContractFactory('AggregatedVerifier')).deploy();
    await verifier.waitForDeployment();
  });

  it('never accepts arbitrary dimensionally valid bytes', async function () {
    await expect(verifier.verifyAggregatedProof(commitment, 2, ethers.hexlify(new Uint8Array(64))))
      .to.be.reverted;
  });

  for (const size of [64, 128]) {
    it(`rejects a fabricated ${size}-byte proof without a success event`, async function () {
      const proof = ethers.hexlify(new Uint8Array(size).fill(42));
      await expect(verifier.verifyAggregatedProof(commitment, 3, proof))
        .to.be.revertedWithCustomError(verifier, 'AggregatedVerificationUnavailable')
        .withArgs(commitment, 3);
      expect(await verifier.queryFilter(verifier.filters.BatchVerified())).to.have.length(0);
    });
  }

  it('also rejects callers other than the owner', async function () {
    await expect(verifier.connect(other).verifyAggregatedProof(commitment, 1, ethers.hexlify(new Uint8Array(64))))
      .to.be.revertedWithCustomError(verifier, 'AggregatedVerificationUnavailable')
      .withArgs(commitment, 1);
  });

  it('retains proof-count validation', async function () {
    await expect(verifier.verifyAggregatedProof(commitment, 0, ethers.hexlify(new Uint8Array(64))))
      .to.be.revertedWith('Proof count must be > 0');
  });

  it('retains proof-dimension validation', async function () {
    await expect(verifier.verifyAggregatedProof(commitment, 1, '0x1234'))
      .to.be.revertedWith('Invalid aggregated proof bytes dimensions');
  });
});
