/**
 * Reed-Solomon (k, m) Erasure Coding & Shard Archival Manager.
 * Splitting freight files into data and parity shards using a real
 * systematic Reed-Solomon code over GF(256).
 *
 * Encoding: the generator matrix G (n x k) is the identity on its top k rows
 * and a Vandermonde block on its bottom m rows (rows evaluated at x = alpha^j).
 * Each parity byte is a GF(256) linear combination of the k data bytes at the
 * same offset. Decoding inverts any k x k square sub-matrix of G formed by the
 * k available shards, so the file can be recovered from ANY k of the n shards
 * (including parity-only reconstruction), unlike the previous implementation
 * which ignored parity shards entirely during decode and silently corrupted
 * files when data shards were lost.
 */

// GF(256) with primitive polynomial 0x11d and generator alpha = 0x02.
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGaloisField() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gmul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function gpow(a, power) {
  if (power === 0) return 1;
  if (a === 0) return 0;
  return GF_EXP[(GF_LOG[a] * power) % 255];
}

function invertSquareMatrix(matrix) {
  // Gauss-Jordan elimination over GF(256).
  const n = matrix.length;
  const m = matrix.map((row) => row.slice());
  const inv = [];
  for (let i = 0; i < n; i++) {
    inv.push(new Array(n).fill(0));
    inv[i][i] = 1;
  }

  for (let col = 0; col < n; col++) {
    let pivot = -1;
    for (let row = col; row < n; row++) {
      if (m[row][col] !== 0) {
        pivot = row;
        break;
      }
    }
    if (pivot === -1) throw new Error('Generator matrix is not invertible for the given shards');

    if (pivot !== col) {
      [m[pivot], m[col]] = [m[col], m[pivot]];
      [inv[pivot], inv[col]] = [inv[col], inv[pivot]];
    }

    const pivotVal = m[col][col];
    for (let j = 0; j < n; j++) {
      m[col][j] = gmul(m[col][j], GF_EXP[(255 - GF_LOG[pivotVal]) % 255]);
      inv[col][j] = gmul(inv[col][j], GF_EXP[(255 - GF_LOG[pivotVal]) % 255]);
    }

    for (let row = 0; row < n; row++) {
      if (row === col || m[row][col] === 0) continue;
      const factor = m[row][col];
      for (let j = 0; j < n; j++) {
        m[row][j] ^= gmul(factor, m[col][j]);
        inv[row][j] ^= gmul(factor, inv[col][j]);
      }
    }
  }

  return inv;
}

export class ReedSolomonStorageManager {
  constructor(k = 4, m = 2) {
    if (!Number.isInteger(k) || k < 1 || k > 255) throw new Error('k must be an integer in [1, 255]');
    if (!Number.isInteger(m) || m < 1 || m > 255) throw new Error('m must be an integer in [1, 255]');
    this.k = k; // Data shards count
    this.m = m; // Parity shards count
    this.n = k + m;
    this.generatorMatrix = this._buildGeneratorMatrix();
  }

  _buildGeneratorMatrix() {
    const g = [];
    for (let i = 0; i < this.k; i++) {
      const row = new Array(this.k).fill(0);
      row[i] = 1;
      g.push(row);
    }
    for (let j = 0; j < this.m; j++) {
      const row = [];
      for (let i = 0; i < this.k; i++) {
        row.push(gpow(0x02, j * i));
      }
      g.push(row);
    }
    return g;
  }

  _encodeShard(shardIndex, dataShards, shardSize) {
    const parity = Buffer.alloc(shardSize);
    const row = this.generatorMatrix[shardIndex];
    for (let i = 0; i < shardSize; i++) {
      let val = 0;
      for (let s = 0; s < this.k; s++) {
        val ^= gmul(row[s], dataShards[s][i]);
      }
      parity[i] = val;
    }
    return parity;
  }

  encodeFile(fileBuffer) {
    const totalSize = fileBuffer.length;
    if (totalSize === 0) throw new Error('Cannot encode an empty file buffer');
    const shardSize = Math.ceil(totalSize / this.k);
    const dataShards = [];

    // Split into zero-padded data shards
    for (let i = 0; i < this.k; i++) {
      const start = i * shardSize;
      const end = Math.min(start + shardSize, totalSize);
      const chunk = Buffer.alloc(shardSize);
      fileBuffer.copy(chunk, 0, start, end);
      dataShards.push(chunk);
    }

    // Real Reed-Solomon parity shards: GF(256) linear combinations
    const shards = dataShards.slice();
    for (let j = 0; j < this.m; j++) {
      shards.push(this._encodeShard(this.k + j, dataShards, shardSize));
    }

    return {
      shardSize,
      shards,
      originalSize: totalSize,
    };
  }

  decodeFile(shardsList, originalSize, shardSize) {
    if (!Array.isArray(shardsList) || shardsList.length === 0) {
      throw new Error('decodeFile requires a non-empty list of shards');
    }

    // null/undefined entries mark missing shards by their position. If the
    // whole set is passed positionally, nulls mark the lost shards; a shorter
    // list of live shards is treated as shards 0..length-1.
    const present = [];
    if (shardsList.some((s) => s == null) || shardsList.length === this.n) {
      for (let i = 0; i < shardsList.length; i++) {
        if (shardsList[i] != null) present.push([i, shardsList[i]]);
      }
    } else {
      for (let i = 0; i < shardsList.length; i++) {
        present.push([i, shardsList[i]]);
      }
    }

    if (present.length < this.k) {
      throw new Error(`Need at least ${this.k} shards to reconstruct, got ${present.length}`);
    }

    const selected = present.slice(0, this.k);
    const matrix = selected.map(([idx]) => this.generatorMatrix[idx].slice());
    const inverse = invertSquareMatrix(matrix);
    const observed = selected.map(([, shard]) => shard);

    const buffer = Buffer.alloc(shardSize * this.k);
    for (let bytePos = 0; bytePos < shardSize; bytePos++) {
      for (let row = 0; row < this.k; row++) {
        let val = 0;
        for (let col = 0; col < this.k; col++) {
          val ^= gmul(inverse[row][col], observed[col][bytePos]);
        }
        buffer[bytePos + row * shardSize] = val;
      }
    }

    return buffer.subarray(0, originalSize);
  }
}

export const rsStorageManager = new ReedSolomonStorageManager();
