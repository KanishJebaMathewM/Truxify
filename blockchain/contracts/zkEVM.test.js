const { expect } = require("chai");
const { ethers } = require("hardhat");

const ZERO_DATA = "0x";
const GAS_PRICE = 10n;
const GAS_LIMIT = 1000n;
const FEE = GAS_PRICE * GAS_LIMIT;

async function deployZkEVM() {
  const [owner, alice, bob, attacker] = await ethers.getSigners();
  const MockVerifier = await ethers.getContractFactory("MockZkEVMVerifier");
  const verifier = await MockVerifier.deploy();
  const zk = await ethers.getContractFactory("zkEVM");
  const contract = await zk.deploy(await verifier.getAddress());
  return { contract, owner, alice, bob, attacker };
}

function validProof() {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256[2]", "uint256[2][2]", "uint256[2]", "uint256[2]"],
    [[1n, 2n], [[3n, 4n], [5n, 6n]], [7n, 8n], [9n, 10n]]
  );
}

async function signTx(signer, tx) {
  const { from, to, value, data, nonce, gasPrice, gasLimit } = tx;
  const digest = ethers.solidityPackedKeccak256(
    ["address", "address", "uint256", "bytes", "uint256", "uint256", "uint256"],
    [from, to, value, data, nonce, gasPrice, gasLimit]
  );
  return signer.signMessage(ethers.getBytes(digest));
}

function encodeBatchTx(tx) {
  const { from, to, value, data, nonce, gasPrice, gasLimit, signature } = tx;
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "uint256", "bytes", "uint256", "uint256", "uint256", "bytes"],
    [from, to, value, data, nonce, gasPrice, gasLimit, signature]
  );
}

describe("zkEVM", function () {
  describe("executeTransaction (single-tx path)", function () {
    it("executes a signed transaction", async function () {
      const { contract, owner, alice, bob } = await deployZkEVM();
      await contract.connect(alice).depositToL2({ value: ethers.parseEther("2") });

      const tx = {
        from: alice.address,
        to: bob.address,
        value: ethers.parseEther("1"),
        data: ZERO_DATA,
        nonce: 0n,
        gasPrice: GAS_PRICE,
        gasLimit: GAS_LIMIT,
      };
      const signature = await signTx(alice, tx);

      await expect(contract.executeTransaction(
        tx.from, tx.to, tx.value, tx.data, tx.nonce, tx.gasPrice, tx.gasLimit, signature
      )).to.emit(contract, "TransactionExecuted");

      expect(await contract.getBalance(alice.address)).to.equal(ethers.parseEther("2") - ethers.parseEther("1") - FEE);
      expect(await contract.getBalance(bob.address)).to.equal(ethers.parseEther("1"));
      expect(await contract.getNonce(alice.address)).to.equal(1n);
    });
  });

  describe("executeBatch — per-tx signature/nonce/balance checks (issue #7735)", function () {
    it("executes a batch of validly signed transactions", async function () {
      const { contract, owner, alice, bob, attacker } = await deployZkEVM();
      await contract.connect(alice).depositToL2({ value: ethers.parseEther("3") });
      await contract.connect(bob).depositToL2({ value: ethers.parseEther("2") });

      const txs = [
        { from: alice.address, to: bob.address, value: ethers.parseEther("1"), data: ZERO_DATA, nonce: 0n, gasPrice: GAS_PRICE, gasLimit: GAS_LIMIT },
        { from: bob.address, to: attacker.address, value: ethers.parseEther("0.5"), data: ZERO_DATA, nonce: 0n, gasPrice: GAS_PRICE, gasLimit: GAS_LIMIT },
      ];
      for (const t of txs) t.signature = await signTx(t.from === alice.address ? alice : bob, t);

      await expect(contract.connect(owner).executeBatch(
        txs.map(encodeBatchTx), validProof()
      )).to.emit(contract, "BatchSubmitted");

      expect(await contract.getBalance(alice.address)).to.equal(ethers.parseEther("3") - ethers.parseEther("1") - FEE);
      expect(await contract.getBalance(bob.address)).to.equal(ethers.parseEther("2") + ethers.parseEther("1") - ethers.parseEther("0.5") - FEE);
      expect(await contract.getBalance(attacker.address)).to.equal(ethers.parseEther("0.5"));
    });

    it("reverts the whole batch when a tx has a forged signature", async function () {
      const { contract, owner, alice, bob } = await deployZkEVM();
      await contract.connect(alice).depositToL2({ value: ethers.parseEther("2") });

      const tx = {
        from: alice.address, to: bob.address, value: ethers.parseEther("1"), data: ZERO_DATA,
        nonce: 0n, gasPrice: GAS_PRICE, gasLimit: GAS_LIMIT,
        signature: (await signTx(bob, {
          from: alice.address, to: bob.address, value: ethers.parseEther("1"), data: ZERO_DATA,
          nonce: 0n, gasPrice: GAS_PRICE, gasLimit: GAS_LIMIT,
        })), // signed by the wrong party
      };

      await expect(
        contract.connect(owner).executeBatch([encodeBatchTx(tx)], validProof())
      ).to.be.revertedWith("Invalid signature");
      expect(await contract.getBalance(alice.address)).to.equal(ethers.parseEther("2"));
    });

    it("reverts the whole batch when a tx reuses a nonce", async function () {
      const { contract, owner, alice, bob } = await deployZkEVM();
      await contract.connect(alice).depositToL2({ value: ethers.parseEther("3") });

      const first = { from: alice.address, to: bob.address, value: ethers.parseEther("1"), data: ZERO_DATA, nonce: 0n, gasPrice: GAS_PRICE, gasLimit: GAS_LIMIT };
      first.signature = await signTx(alice, first);
      await contract.connect(owner).executeBatch([encodeBatchTx(first)], validProof());

      // Same nonce again with different content (different tx digest), even
      // with a fresh signature — the usedNonces gate rejects it.
      const second = { from: alice.address, to: bob.address, value: ethers.parseEther("0.5"), data: ZERO_DATA, nonce: 0n, gasPrice: GAS_PRICE, gasLimit: GAS_LIMIT };
      second.signature = await signTx(alice, second);

      await expect(
        contract.connect(owner).executeBatch([encodeBatchTx(second)], validProof())
      ).to.be.revertedWith("Nonce already used");
    });

    it("reverts the whole batch when from lacks balance (no negative balances)", async function () {
      const { contract, owner, alice, bob } = await deployZkEVM();
      await contract.connect(alice).depositToL2({ value: ethers.parseEther("0.1") });

      const tx = { from: alice.address, to: bob.address, value: ethers.parseEther("1"), data: ZERO_DATA, nonce: 0n, gasPrice: GAS_PRICE, gasLimit: GAS_LIMIT };
      tx.signature = await signTx(alice, tx);

      await expect(
        contract.connect(owner).executeBatch([encodeBatchTx(tx)], validProof())
      ).to.be.revertedWith("Insufficient balance");
      expect(await contract.getBalance(alice.address)).to.equal(ethers.parseEther("0.1"));
    });

    it("rejects duplicate transactions within a batch", async function () {
      const { contract, owner, alice, bob } = await deployZkEVM();
      await contract.connect(alice).depositToL2({ value: ethers.parseEther("3") });

      const tx = { from: alice.address, to: bob.address, value: ethers.parseEther("1"), data: ZERO_DATA, nonce: 0n, gasPrice: GAS_PRICE, gasLimit: GAS_LIMIT };
      tx.signature = await signTx(alice, tx);
      const encoded = encodeBatchTx(tx);

      await expect(
        contract.connect(owner).executeBatch([encoded, encoded], validProof())
      ).to.be.revertedWith("Duplicate transaction");
    });

    it("is only callable by the owner", async function () {
      const { contract, attacker } = await deployZkEVM();
      await expect(
        contract.connect(attacker).executeBatch([], validProof())
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });

    it("rejects an empty proof", async function () {
      const { contract, owner, alice, bob } = await deployZkEVM();
      await contract.connect(alice).depositToL2({ value: ethers.parseEther("2") });

      const tx = { from: alice.address, to: bob.address, value: ethers.parseEther("1"), data: ZERO_DATA, nonce: 0n, gasPrice: GAS_PRICE, gasLimit: GAS_LIMIT };
      tx.signature = await signTx(alice, tx);

      await expect(
        contract.connect(owner).executeBatch([encodeBatchTx(tx)], "0x")
      ).to.be.revertedWith("Empty proof");
      expect(await contract.getBalance(alice.address)).to.equal(ethers.parseEther("2"));
    });
  });
});
