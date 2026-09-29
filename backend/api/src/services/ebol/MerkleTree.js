import crypto from 'crypto';

/**
 * Utility to compute a SHA-256 digest of input data, returning a 0x-prefixed 32-byte hex string.
 * 
 * @param {string|Buffer} data - Raw data or digest string
 * @returns {string} 0x-prefixed 32-byte hex string
 */
export function sha256Hash(data) {
  if (data === null || data === undefined) {
    throw new TypeError('Cannot hash null or undefined data');
  }
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  return '0x' + crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Combines two 32-byte hashes in a sorted, canonical manner to avoid second-preimage vulnerabilities.
 * 
 * @param {string} a - 0x-prefixed 32-byte hex string
 * @param {string} b - 0x-prefixed 32-byte hex string
 * @returns {string} 0x-prefixed 32-byte hex string
 */
export function combineHashes(a, b) {
  const normA = a.toLowerCase();
  const normB = b.toLowerCase();
  const [left, right] = normA < normB ? [normA, normB] : [normB, normA];
  const combinedBuffer = Buffer.concat([
    Buffer.from(left.replace(/^0x/, ''), 'hex'),
    Buffer.from(right.replace(/^0x/, ''), 'hex'),
  ]);
  return '0x' + crypto.createHash('sha256').update(combinedBuffer).digest('hex');
}

/**
 * In-memory SHA-256 Merkle Tree for physical cargo tamper seals and weigh-station inspection tokens.
 * Supports O(log n) inclusion proof generation and verification.
 */
export class MerkleTree {
  /**
   * @param {Array<string|Buffer>} [elements=[]] - Initial leaves or data elements
   */
  constructor(elements = []) {
    this.leaves = [];
    this.layers = [];

    if (Array.isArray(elements) && elements.length > 0) {
      this.leaves = elements.map(el => (this._is32ByteHex(el) ? el.toLowerCase() : sha256Hash(el).toLowerCase()));
      this._buildTree();
    } else {
      this.layers = [[]];
    }
  }

  /**
   * Check if a value is already a 0x-prefixed 32-byte hex string.
   * @private
   */
  _is32ByteHex(val) {
    return typeof val === 'string' && /^0x[0-9a-fA-F]{64}$/.test(val);
  }

  /**
   * Builds the internal Merkle layers from the leaves array.
   * @private
   */
  _buildTree() {
    if (this.leaves.length === 0) {
      this.layers = [[]];
      return;
    }

    this.layers = [[...this.leaves]];

    while (this.layers[this.layers.length - 1].length > 1) {
      const currentLayer = this.layers[this.layers.length - 1];
      const nextLayer = [];

      for (let i = 0; i < currentLayer.length; i += 2) {
        if (i + 1 < currentLayer.length) {
          nextLayer.push(combineHashes(currentLayer[i], currentLayer[i + 1]));
        } else {
          // Odd node: duplicate or promote to maintain binary tree shape
          nextLayer.push(combineHashes(currentLayer[i], currentLayer[i]));
        }
      }

      this.layers.push(nextLayer);
    }
  }

  /**
   * Adds a new leaf to the tree and rebuilds layers.
   * 
   * @param {string|Buffer} element - Element to add
   * @returns {string} Newly computed leaf hash
   */
  addLeaf(element) {
    const leafHash = this._is32ByteHex(element) ? element.toLowerCase() : sha256Hash(element).toLowerCase();
    this.leaves.push(leafHash);
    this._buildTree();
    return leafHash;
  }

  /**
   * Retrieves the Merkle Root hash (0x-prefixed 32-byte hex).
   * 
   * @returns {string} Merkle Root
   */
  getRoot() {
    if (this.leaves.length === 0) {
      return '0x' + '0'.repeat(64);
    }
    const topLayer = this.layers[this.layers.length - 1];
    return topLayer[0] || ('0x' + '0'.repeat(64));
  }

  /**
   * Generates an O(log n) Merkle inclusion proof for a given leaf.
   * 
   * @param {string|number} leafOrIndex - Leaf hash or leaf index
   * @returns {Array<{position: 'left'|'right', data: string}>} Inclusion proof
   */
  getProof(leafOrIndex) {
    const targetIndex = typeof leafOrIndex === 'number'
      ? leafOrIndex
      : this.leaves.indexOf(
          this._is32ByteHex(leafOrIndex)
            ? leafOrIndex.toLowerCase()
            : sha256Hash(leafOrIndex).toLowerCase()
        );

    if (targetIndex < 0 || targetIndex >= this.leaves.length) {
      return [];
    }

    const proof = [];
    let currentIndex = targetIndex;

    for (let layerIndex = 0; layerIndex < this.layers.length - 1; layerIndex++) {
      const currentLayer = this.layers[layerIndex];
      const isRightNode = currentIndex % 2 === 1;
      const pairIndex = isRightNode ? currentIndex - 1 : currentIndex + 1;

      if (pairIndex < currentLayer.length) {
        proof.push({
          position: isRightNode ? 'left' : 'right',
          data: currentLayer[pairIndex],
        });
      } else {
        // Node was paired with itself
        proof.push({
          position: 'right',
          data: currentLayer[currentIndex],
        });
      }

      if (layerIndex < this.layers.length - 2) {
        currentIndex = Math.floor(currentIndex / 2);
      }
    }

    return proof;
  }

  /**
   * Verifies an O(log n) Merkle inclusion proof against a root.
   * 
   * @param {Array<{position: 'left'|'right', data: string}>} proof - Inclusion proof
   * @param {string} leaf - Leaf hash or raw data
   * @param {string} root - Expected Merkle root
   * @returns {boolean} True if leaf is cryptographically proven to be in the tree
   */
  static verifyProof(proof, leaf, root) {
    if (!Array.isArray(proof) || !leaf || !root) {
      return false;
    }

    let currentHash = (typeof leaf === 'string' && /^0x[0-9a-fA-F]{64}$/.test(leaf))
      ? leaf.toLowerCase()
      : sha256Hash(leaf).toLowerCase();

    const expectedRoot = root.toLowerCase();

    for (const step of proof) {
      if (!step || !step.data) {
        return false;
      }
      currentHash = combineHashes(currentHash, step.data.toLowerCase());
    }

    return currentHash === expectedRoot;
  }
}
