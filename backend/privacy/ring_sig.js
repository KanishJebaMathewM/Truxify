import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes, concatBytes, utf8ToBytes } from '@noble/hashes/utils';

const G = secp256k1.ProjectivePoint.BASE;
const N = secp256k1.CURVE.n;
const P = secp256k1.CURVE.p;

const strip0x = (hex) => (typeof hex === 'string' && hex.startsWith('0x') ? hex.slice(2) : hex);
const toBigInt = (value) => {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (value instanceof Uint8Array) return BigInt('0x' + bytesToHex(value));
  if (typeof value === 'string') return BigInt('0x' + strip0x(value));
  throw new TypeError('Invalid scalar value');
};
const mod = (a, m) => ((a % m) + m) % m;
const modPow = (base, exp, m) => {
  let result = 1n;
  let b = mod(base, m);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
};
const sqrtModP = (a) => modPow(a, (P + 1n) / 4n, P);
const pointFromHex = (hex) => secp256k1.ProjectivePoint.fromHex(strip0x(hex));

const hashToPoint = (seedHex) => {
  let counter = 0;
  for (;;) {
    const digest = keccak_256(concatBytes(hexToBytes(seedHex), hexToBytes(counter.toString(16).padStart(2, '0'))));
    const x = BigInt('0x' + bytesToHex(digest)) % P;
    const rhs = mod(x * x * x + 7n, P);
    const y = sqrtModP(rhs);
    if (mod(y * y, P) === rhs) {
      return secp256k1.ProjectivePoint.fromAffine({ x, y });
    }
    counter += 1;
  }
};

const hashHex = (...parts) =>
  bytesToHex(keccak_256(concatBytes(...parts.map((part) => hexToBytes(strip0x(part))))));

/**
 * Off-Chain Linkable Ring Signature (LSAG) Generator Utility
 *
 * Implements the Liu-Wei-Wong linkable spontaneous anonymous group signature
 * over secp256k1. The challenge chain binds every `c`/`r` to the full ring, the
 * message, and the signer's private key via the key image, so signatures are
 * unforgeable and linkable (same signer + same ring => same key image).
 */
export class RingSignatureService {
  generateRingKeyPair() {
    const privateKey = secp256k1.utils.randomPrivateKey();
    const publicKey = secp256k1.ProjectivePoint.fromPrivateKey(privateKey).toHex(true);
    return {
      privateKey: `0x${bytesToHex(privateKey)}`,
      publicKey,
    };
  }

  generateKeyImage(pubKeys, signerPrivateKey) {
    const Hp = hashToPoint(pubKeys.map((k) => strip0x(k)).join(''));
    return Hp.multiply(toBigInt(signerPrivateKey)).toHex(true);
  }

  hashMessage(message) {
    return bytesToHex(keccak_256(utf8ToBytes(message)));
  }

  challenge(pubKeys, messageHash, pointA, pointB) {
    return hashHex(pubKeys.map((k) => strip0x(k)).join(''), messageHash, pointA.toHex(true), pointB.toHex(true));
  }

  signRingMessage(message, pubKeys, signerPrivateKey) {
    const n = pubKeys.length;
    if (n < 2) {
      throw new Error('A ring signature requires at least two public keys');
    }
    const messageHash = this.hashMessage(message);
    const ring = pubKeys.map((k) => pointFromHex(k));
    const ringSeed = pubKeys.map((k) => strip0x(k)).join('');
    const Hp = hashToPoint(ringSeed);
    const x = toBigInt(signerPrivateKey);
    const signerPoint = G.multiply(x);
    const s = ring.findIndex((point) => point.equals(signerPoint));
    if (s < 0) {
      throw new Error('Signer private key does not match any public key in the ring');
    }

    const keyImage = Hp.multiply(x);

    const u = toBigInt(secp256k1.utils.randomPrivateKey());
    const uG = G.multiply(u);
    const uHp = Hp.multiply(u);

    const c = new Array(n);
    const r = new Array(n);
    c[(s + 1) % n] = this.challenge(pubKeys, messageHash, uG, uHp);

    let i = (s + 1) % n;
    while (i !== s) {
      const ri = toBigInt(secp256k1.utils.randomPrivateKey());
      const ci = BigInt('0x' + c[i]) % N;
      r[i] = ri;
      const Li = G.multiply(ri).add(ring[i].multiply(ci));
      const Ri = Hp.multiply(ri).add(keyImage.multiply(ci));
      const next = (i + 1) % n;
      c[next] = this.challenge(pubKeys, messageHash, Li, Ri);
      i = next;
    }

    const cs = BigInt('0x' + c[s]) % N;
    r[s] = mod(u - cs * x, N);

    return {
      messageHash,
      keyImage: keyImage.toHex(true),
      c,
      r: r.map((value) => value.toString(16).padStart(64, '0')),
      pubKeys,
    };
  }

  verifyRingSignature(message, pubKeys, signature) {
    const n = pubKeys.length;
    if (!signature || !Array.isArray(signature.c) || !Array.isArray(signature.r) ||
        signature.c.length !== n || signature.r.length !== n || !signature.keyImage) {
      return false;
    }
    let keyImagePoint;
    try {
      keyImagePoint = pointFromHex(signature.keyImage);
    } catch {
      return false;
    }
    const messageHash = this.hashMessage(message);
    if (signature.messageHash && signature.messageHash !== messageHash) {
      return false;
    }
    const ring = pubKeys.map((k) => pointFromHex(k));
    const Hp = hashToPoint(pubKeys.map((k) => strip0x(k)).join(''));
    try {
      let c = signature.c[0];
      for (let i = 0; i < n; i += 1) {
        const ri = toBigInt(signature.r[i]);
        const ci = BigInt('0x' + c) % N;
        const Li = G.multiply(ri).add(ring[i].multiply(ci));
        const Ri = Hp.multiply(ri).add(keyImagePoint.multiply(ci));
        c = this.challenge(pubKeys, messageHash, Li, Ri);
      }
      return c === signature.c[0];
    } catch {
      return false;
    }
  }
}

export const ringSignatureService = new RingSignatureService();
