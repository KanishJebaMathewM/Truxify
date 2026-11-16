import { ethers } from 'ethers';

/**
 * Off-Chain Linkable Ring Signature (LSAG) service over secp256k1.
 *
 * A ring signature lets one member of a ring sign a message such that a
 * verifier learns only that SOME ring member signed — not which one. The
 * key image makes signatures by the same signer (under the same key)
 * linkable without revealing the signer, so double-signing is detectable.
 *
 * Signature shape: { messageHash, keyImage, c[], r[], pubKeys } where the
 * c chain closes around the ring: c_{i+1} = H(L, r_i·G + c_i·P_i,
 * r_i·Hp(P_i) + c_i·I) with L binding the message, ring and key image.
 */

// ---- secp256k1 field arithmetic (affine, BigInt — fine for an off-chain
// utility; not constant-time, so keys handled here must stay off-chain) ----
const P = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F');
const N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
const GX = BigInt('0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798');
const GY = BigInt('0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8');
const G = [GX, GY];

const mod = (a, m = P) => ((a % m) + m) % m;

function modInv(a, m = P) {
  let [lm, hm, low, high] = [1n, 0n, mod(a, m), m];
  while (low > 1n) {
    const r = high / low;
    [lm, hm] = [hm - lm * r, lm];
    [low, high] = [high - low * r, low];
  }
  return mod(lm, m);
}

function pointAdd(p, q) {
  if (p === null) return q;
  if (q === null) return p;
  const [x1, y1] = p;
  const [x2, y2] = q;
  if (x1 === x2) {
    if (mod(y1 + y2) === 0n) return null; // p + (-p) = infinity
    const s = mod(3n * x1 * x1 * modInv(2n * y1));
    const x3 = mod(s * s - 2n * x1);
    return [x3, mod(s * (x1 - x3) - y1)];
  }
  const s = mod((y2 - y1) * modInv(x2 - x1));
  const x3 = mod(s * s - x1 - x2);
  return [x3, mod(s * (x1 - x3) - y1)];
}

function pointMul(k, point = G) {
  let result = null;
  let addend = point;
  k = mod(k, N);
  while (k > 0n) {
    if (k & 1n) result = pointAdd(result, addend);
    addend = pointAdd(addend, addend);
    k >>= 1n;
  }
  return result;
}

// Try-and-increment hash-to-curve for Hp (deterministic, domain-separated).
function hashToPoint(tag, data) {
  let counter = 0n;
  for (;;) {
    const x = mod(BigInt(ethers.keccak256(ethers.toUtf8Bytes(`${tag}:${data}:${counter}`))));
    const y2 = mod(x * x * x + 7n);
    const y = modPow(y2, (P + 1n) / 4n); // P ≡ 3 (mod 4)
    if (mod(y * y) === y2) return [x, y];
    counter++;
  }
}

function modPow(base, exp, m = P) {
  let result = 1n;
  base = mod(base, m);
  while (exp > 0n) {
    if (exp & 1n) result = mod(result * base, m);
    base = mod(base * base, m);
    exp >>= 1n;
  }
  return result;
}

const hexToBig = (h) => BigInt(h.startsWith('0x') ? h : `0x${h}`);
const bigToHex = (b) => `0x${mod(b).toString(16).padStart(64, '0')}`;

function parsePublicKey(pubKey) {
  // Accept an uncompressed (0x04...) or compressed (0x02/0x03...) point.
  const hex = pubKey.startsWith('0x') ? pubKey.slice(2) : pubKey;
  if (hex.length === 130 && hex.startsWith('04')) {
    return [BigInt(`0x${hex.slice(2, 66)}`), BigInt(`0x${hex.slice(66)}`)];
  }
  if (hex.length === 66 && (hex.startsWith('02') || hex.startsWith('03'))) {
    const x = BigInt(`0x${hex.slice(2)}`);
    const y2 = mod(x * x * x + 7n);
    let y = modPow(y2, (P + 1n) / 4n);
    if (mod(y * y) !== y2) throw new Error('RingSignatureService: public key is not on secp256k1');
    if (y % 2n !== BigInt(hex.startsWith('03') ? 1 : 0)) y = mod(-y);
    return [x, y];
  }
  if (hex.length === 64) {
    const x = BigInt(`0x${hex}`);
    const y2 = mod(x * x * x + 7n);
    const y = modPow(y2, (P + 1n) / 4n);
    if (mod(y * y) !== y2) throw new Error('RingSignatureService: public key is not on secp256k1');
    return [x, y];
  }
  throw new Error('RingSignatureService: unsupported public key encoding');
}

function randomScalar() {
  return mod(BigInt(ethers.hexlify(ethers.randomBytes(32))), N);
}

export class RingSignatureService {
  generateRingKeyPair() {
    const wallet = ethers.Wallet.createRandom();
    return {
      privateKey: wallet.privateKey,
      // Full curve point (x only would be ambiguous); verification needs the
      // point, not the derived address.
      publicKey: wallet.signingKey.publicKey, // compressed 0x02/0x03 point
    };
  }

  hashMessage(message) {
    return ethers.keccak256(ethers.toUtf8Bytes(message));
  }

  generateKeyImage(ring, privateKey) {
    // I = x·Hp(P_signer): deterministic per signer key, so signatures by the
    // same signer are linkable and different signers produce different images.
    const x = hexToBig(privateKey);
    const signerPoint = pointMul(x);
    const image = pointMul(x, hashToPoint('LSAG_HP', pointKey(signerPoint)));
    return pointKey(image);
  }

  signRingMessage(message, pubKeys, signerPrivateKey) {
    const x = mod(hexToBig(signerPrivateKey), N);
    const signerPoint = pointMul(x);
    const s = pubKeys.findIndex((pk) => {
      try {
        return pointKey(parsePublicKey(pk)) === pointKey(signerPoint);
      } catch {
        return false;
      }
    });
    if (s === -1) {
      throw new Error('RingSignatureService: signer private key does not match any ring member');
    }

    const n = pubKeys.length;
    const points = pubKeys.map(parsePublicKey);
    const hpPoints = points.map((pt) => hashToPoint('LSAG_HP', pointKey(pt)));
    const keyImage = this.generateKeyImage(pubKeys, signerPrivateKey);
    const imagePoint = parsePublicKey(keyImage);
    const messageHash = this.hashMessage(message);
    const L = ethers.keccak256(
      ethers.toUtf8Bytes(`${messageHash}:${pubKeys.join(',')}:${keyImage}`)
    );

    const c = new Array(n);
    const r = new Array(n);

    const link = (cc, rr, i) =>
      mod(
        BigInt(
          ethers.keccak256(
            ethers.toUtf8Bytes(
              `${L}:${pointKey(pointAdd(pointMul(rr), pointMul(cc, points[i])))}:` +
                `${pointKey(pointAdd(pointMul(rr, hpPoints[i]), pointMul(cc, imagePoint)))}`
            )
          )
        ),
        N
      );

    let alpha = randomScalar();
    c[(s + 1) % n] = link(0n, alpha, s); // c_{s+1} = H(L, αG, αHp(P_s))
    for (let step = 1; step < n; step++) {
      const i = (s + step) % n;
      r[i] = randomScalar();
      c[(i + 1) % n] = link(c[i], r[i], i);
    }
    // Close the ring: r_s = α − c_s·x (mod N)
    r[s] = mod(alpha - c[s] * x, N);

    return {
      messageHash,
      keyImage,
      c: c.map(bigToHex),
      r: r.map(bigToHex),
      pubKeys,
    };
  }

  verifyRingSignature(message, pubKeys, signature) {
    try {
      if (!signature || !Array.isArray(signature.c) || !Array.isArray(signature.r)) return false;
      const n = pubKeys.length;
      if (signature.c.length !== n || signature.r.length !== n) return false;
      if (signature.messageHash !== this.hashMessage(message)) return false;
      // The signature is bound to the exact ring it was produced for.
      if (!Array.isArray(signature.pubKeys) || signature.pubKeys.length !== n) return false;
      for (let i = 0; i < n; i++) {
        if (signature.pubKeys[i] !== pubKeys[i]) return false;
      }

      const points = pubKeys.map(parsePublicKey);
      const hpPoints = points.map((pt) => hashToPoint('LSAG_HP', pointKey(pt)));
      const imagePoint = parsePublicKey(signature.keyImage);
      const messageHash = this.hashMessage(message);
      const L = ethers.keccak256(
        ethers.toUtf8Bytes(`${messageHash}:${pubKeys.join(',')}:${signature.keyImage}`)
      );

      const c = signature.c.map(hexToBig);
      const r = signature.r.map(hexToBig);

      // Walk the chain from c_0 all the way around: it must close back to c_0.
      let current = c[0];
      for (let i = 0; i < n; i++) {
        if (c[i] !== current) return false; // stored chain must match recomputation
        current = mod(
          BigInt(
            ethers.keccak256(
              ethers.toUtf8Bytes(
                `${L}:${pointKey(pointAdd(pointMul(r[i]), pointMul(c[i], points[i])))}:` +
                  `${pointKey(pointAdd(pointMul(r[i], hpPoints[i]), pointMul(c[i], imagePoint)))}`
              )
            )
          ),
          N
        );
      }
      return current === c[0];
    } catch {
      return false; // malformed scalars/points are invalid signatures
    }
  }
}

function pointKey(point) {
  // Canonical compressed encoding used for hashing.
  const [x, y] = point;
  return `${y % 2n === 0n ? '02' : '03'}${x.toString(16).padStart(64, '0')}`;
}

export const ringSignatureService = new RingSignatureService();
