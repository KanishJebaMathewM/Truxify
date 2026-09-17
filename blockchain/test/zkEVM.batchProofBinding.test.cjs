const { expect } = require('chai');
const { ethers } = require('hardhat');

const SNARK_FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const TX_TYPES = [
  'address',
  'address',
  'uint256',
  'bytes',
  'uint256',
  'uint256',
  'uint256',
  'bytes',
];

const TX_HASH_TYPES = [
  'uint256',
  'address',
  'address',
  'uint256',
  'bytes',
  'uint256',
  'uint256',
  'uint256',
];

const BATCH_COMMITMENT_TYPES = ['uint256', 'address', 'bytes[]'];

function toFieldElement(value) {
  return BigInt(value) % SNARK_FIELD_MODULUS;
}

function encodeTransaction({ from, to, value, data, nonce, gasPrice, gasLimit, signature }) {
  return ethers.AbiCoder.defaultAbiCoder().encode(TX_TYPES, [
    from,
    to,
    value,
    data,
    nonce,
    gasPrice,
    gasLimit,
    signature,
  ]);
}

function transactionHash({ chainId, contractAddress, from, to, value, data, nonce, gasPrice, gasLimit }) {
  return ethers.keccak256(
    ethers.solidityPacked(TX_HASH_TYPES, [
      chainId,
      contractAddress,
      from,
      to,
      value,
      data,
      nonce,
      gasPrice,
      gasLimit,
    ])
  );
}

function batchCommitment({ chainId, contractAddress, transactionsData }) {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(BATCH_COMMITMENT_TYPES, [
    chainId,
    contractAddress,
    transactionsData,
  ]);

  return toFieldElement(ethers.keccak256(encoded));
}

function stateTransitionRoot(root, { from, to, value, nonce }) {
  return ethers.keccak256(
    ethers.solidityPacked(
      ['bytes32', 'address', 'address', 'uint256', 'uint256'],
      [root, from, to, value, nonce]
    )
  );
}

function finalBatchRoot(root, timestamp, batchId) {
  return ethers.keccak256(
    ethers.solidityPacked(['bytes32', 'uint256', 'uint256'], [root, timestamp, batchId])
  );
}

function encodeProof(input0, input1) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint256[2]', 'uint256[2][2]', 'uint256[2]', 'uint256[2]'],
    [
      [0, 0],
      [
        [0, 0],
        [0, 0],
      ],
      [0, 0],
      [input0, input1],
    ]
  );
}

describe('zkEVM executeBatch proof binding', function () {
  let owner;
  let sender;
  let recipient;
  let zkEVM;
  let chainId;

  async function deployFixture() {
    [owner, sender, recipient] = await ethers.getSigners();

    const network = await ethers.provider.getNetwork();
    chainId = network.chainId;

    const Verifier = await ethers.getContractFactory('MockZkEVMVerifier');
    const verifier = await Verifier.deploy();
    await verifier.waitForDeployment();

    const ZkEVM = await ethers.getContractFactory('zkEVM');
    zkEVM = await ZkEVM.deploy(await verifier.getAddress());
    await zkEVM.waitForDeployment();

    await zkEVM.connect(sender).depositToL2({ value: ethers.parseEther('1') });
  }

  async function buildTransaction(data = '0x') {
    const tx = {
      from: sender.address,
      to: recipient.address,
      value: 1000n,
      data,
      nonce: await zkEVM.getNonce(sender.address),
      gasPrice: 0n,
      gasLimit: 0n,
    };

    const digest = transactionHash({
      chainId,
      contractAddress: await zkEVM.getAddress(),
      ...tx,
    });

    return {
      ...tx,
      signature: await sender.signMessage(ethers.getBytes(digest)),
    };
  }

  beforeEach(async function () {
    await deployFixture();
  });

  it('accepts a proof bound to the exact batch and resulting state root', async function () {
    const tx = await buildTransaction();
    const encoded = encodeTransaction(tx);
    const rootBefore = await zkEVM.getStateRoot();
    const batchId = (await zkEVM.getTotalBatches()) + 1n;
    const block = await ethers.provider.getBlock('latest');
    const timestamp = BigInt(block.timestamp + 1);

    await ethers.provider.send('evm_setNextBlockTimestamp', [Number(timestamp)]);

    const expectedPostTxRoot = stateTransitionRoot(rootBefore, tx);
    const expectedNewStateRoot = finalBatchRoot(expectedPostTxRoot, timestamp, batchId);
    const commitment = batchCommitment({
      chainId,
      contractAddress: await zkEVM.getAddress(),
      transactionsData: [encoded],
    });
    const proof = encodeProof(commitment, toFieldElement(expectedNewStateRoot));

    await expect(zkEVM.executeBatch([encoded], proof)).to.not.be.reverted;

    const batch = await zkEVM.getBatch(batchId);
    expect(batch.verified).to.equal(true);
    expect(batch.stateRoot).to.equal(rootBefore);
    expect(batch.newStateRoot).to.equal(expectedNewStateRoot);
    expect(await zkEVM.getStateRoot()).to.equal(expectedNewStateRoot);
  });

  it('rejects a proof when transactionsData changes after the proof is generated', async function () {
    const originalTx = await buildTransaction('0x');
    const originalEncoded = encodeTransaction(originalTx);
    const modifiedTx = { ...originalTx, data: '0x1234' };
    const modifiedEncoded = encodeTransaction(modifiedTx);
    const rootBefore = await zkEVM.getStateRoot();
    const batchId = (await zkEVM.getTotalBatches()) + 1n;
    const block = await ethers.provider.getBlock('latest');
    const timestamp = BigInt(block.timestamp + 1);

    await ethers.provider.send('evm_setNextBlockTimestamp', [Number(timestamp)]);

    const expectedNewStateRoot = finalBatchRoot(
      stateTransitionRoot(rootBefore, modifiedTx),
      timestamp,
      batchId
    );
    const originalCommitment = batchCommitment({
      chainId,
      contractAddress: await zkEVM.getAddress(),
      transactionsData: [originalEncoded],
    });
    const proof = encodeProof(originalCommitment, toFieldElement(expectedNewStateRoot));

    await expect(zkEVM.executeBatch([modifiedEncoded], proof)).to.be.revertedWith(
      'Batch commitment mismatch'
    );
    expect(await zkEVM.getTotalBatches()).to.equal(0n);
    expect(await zkEVM.getStateRoot()).to.equal(rootBefore);
  });

  it('rejects a proof when its committed resulting state root does not match the batch', async function () {
    const tx = await buildTransaction();
    const encoded = encodeTransaction(tx);
    const rootBefore = await zkEVM.getStateRoot();
    const batchId = (await zkEVM.getTotalBatches()) + 1n;
    const block = await ethers.provider.getBlock('latest');
    const timestamp = BigInt(block.timestamp + 1);

    await ethers.provider.send('evm_setNextBlockTimestamp', [Number(timestamp)]);

    const expectedNewStateRoot = finalBatchRoot(
      stateTransitionRoot(rootBefore, tx),
      timestamp,
      batchId
    );
    const commitment = batchCommitment({
      chainId,
      contractAddress: await zkEVM.getAddress(),
      transactionsData: [encoded],
    });
    const wrongStateRoot = toFieldElement(expectedNewStateRoot + 1n);
    const proof = encodeProof(commitment, wrongStateRoot);

    await expect(zkEVM.executeBatch([encoded], proof)).to.be.revertedWith(
      'Batch state root mismatch'
    );
    expect(await zkEVM.getTotalBatches()).to.equal(0n);
    expect(await zkEVM.getStateRoot()).to.equal(rootBefore);
  });
});
