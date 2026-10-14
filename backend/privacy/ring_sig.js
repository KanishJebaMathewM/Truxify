import { ethers } from 'ethers';

/**
 * Off-Chain Linkable Ring Signature (LSAG) over secp256k1.
 *
 * Ring members' keys are real curve points (uncompressed 0x04|x|y hex). The
 * signature proves one ring member signed without revealing which, and the
 * key image makes double-signing linkable. The previous implementation hashed
 * per-index placeholders that never involved the private key (and shipped no
 * verifier at all) — anyone could 'sign' for any ring. This is a real LSAG:
 *   c_{i+1} = H(m, r_i·G + c_i·P_i, r_i·Hp(P_i) + c_i·I)
 * closing the ring; the signer's r is u − c·x mod n.
 */

// ── secp256k1 field/group arithmetic (BigInt, no dependencies) ──────────────

const P = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F');
const N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
const GX = BigInt('0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798');
const GY = BigInt('0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8');
const G = { x: GX, y: GY };

const mod = (a, m) => ((a % m) + m) % m;

function modInv(a, m) {
  // Extended Euclidean algorithm: divide the REMAINDER sequence (old_r by r).
  let [oldR, r] = [m, mod(a, m)];
  let [oldS, ss] = [0n, 1n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, ss] = [ss, oldS - q * ss];
  }
  return mod(oldS, m);
}

function pointAdd(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  if (a.x === b.x) {
    if (mod(a.y + b.y, P) === 0n) return null;
    // point doubling
    const lambda = mod((3n * a.x * a.x) * modInv(2n * a.y, P), P);
    const x = mod(lambda * lambda - 2n * a.x, P);
    return { x, y: mod(lambda * (a.x - x) - a.y, P) };
  }
  const lambda = mod((b.y - a.y) * modInv(b.x - a.x, P), P);
  const x = mod(lambda * lambda - a.x - b.x, P);
  return { x, y: mod(lambda * (a.x - x) - a.y, P) };
}

function pointMul(k, point) {
  let scalar = mod(k, N);
  let result = null;
  let addend = point;
  while (scalar > 0n) {
    if (scalar & 1n) result = pointAdd(result, addend);
    addend = pointAdd(addend, addend);
    scalar >>= 1n;
  }
  return result;
}

function isOnCurve(pt) {
  return pt !== null && mod(pt.y * pt.y - (pt.x * pt.x * pt.x + 7n), P) === 0n;
}

function pointToHex(pt) {
  return '0x04' + pt.x.toString(16).padStart(64, '0') + pt.y.toString(16).padStart(64, '0');
}

function pointFromHex(hex) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length !== 130 || !clean.startsWith('04')) {
    throw new Error('Ring keys must be uncompressed secp256k1 points (0x04|x|y)');
  }
  const pt = { x: BigInt('0x' + clean.slice(2, 66)), y: BigInt('0x' + clean.slice(66)) };
  if (!isOnCurve(pt)) throw new Error('Ring key is not on the secp256k1 curve');
  return pt;
}

function modPow(base, exp, m) {
  let result = 1n;
  let b = mod(base, m);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = mod(result * b, m);
    b = mod(b * b, m);
    e >>= 1n;
  }
  return result;
}

/** Hash-to-curve (try-and-increment) — maps a public key to a curve point. */
function hashToPoint(pointHex) {
  let counter = 0n;
  for (;;) {
    const candidate = mod(BigInt(ethers.keccak256(ethers.toUtf8Bytes(pointHex + ':' + counter.toString()))), P);
    const y2 = mod(candidate * candidate * candidate + 7n, P);
    // p ≡ 3 (mod 4): sqrt via exponentiation when residue
    const y = modPow(y2, (P + 1n) / 4n, P);
    if (mod(y * y, P) === y2) return { x: candidate, y };
    counter++;
  }
}

function challenge(messageHash, lPoint, rPoint) {
  return mod(
    BigInt(
      ethers.keccak256(
        ethers.toUtf8Bytes('LSAG|' + messageHash + '|' + pointToHex(lPoint) + '|' + pointToHex(rPoint)),
      ),
    ),
    N,
  );
}

export class RingSignatureService {
  /** A fresh secp256k1 ring keypair (public key is the CURVE POINT, hex). */
  generateRingKeyPair() {
    const wallet = ethers.Wallet.createRandom();
    return {
      privateKey: wallet.privateKey,
      publicKey: ethers.SigningKey.computePublicKey(wallet.privateKey, false),
    };
  }

  /** keccak256 of the UTF-8 message bytes. */
  hashMessage(message) {
    return ethers.keccak256(ethers.toUtf8Bytes(message));
  }

  /** The linkable key image: I = x·Hp(P) — same signer ⇒ same image. */
  generateKeyImage(privateKeyOrRing, maybePrivateKey) {
    // Accepts (privateKey) and (ring, privateKey) — the ring is not part of
    // the image (it binds the signer only).
    const privateKey = maybePrivateKey ?? privateKeyOrRing;
    const x = mod(BigInt(privateKey), N);
    const publicKeyHex = ethers.SigningKey.computePublicKey(privateKey, false);
    return pointToHex(pointMul(x, hashToPoint(publicKeyHex)));
  }

  /** Sign [message] on behalf of the ring; signerPrivateKey must belong to a member. */
  signRingMessage(message, pubKeys, signerPrivateKey) {
    const points = pubKeys.map(pointFromHex);
    const x = mod(BigInt(signerPrivateKey), N);
    const signerPub = ethers.SigningKey.computePublicKey(signerPrivateKey, false);
    const signerIndex = pubKeys.findIndex((k) => k.toLowerCase() === signerPub.toLowerCase());
    if (signerIndex < 0) throw new Error('Signer private key does not match any ring member');

    const messageHash = ethers.keccak256(ethers.toUtf8Bytes(message));
    const hp = points.map((pt) => hashToPoint(pointToHex(pt)));
    const keyImage = pointToHex(pointMul(x, hp[signerIndex]));

    const n = points.length;
    const c = new Array(n);
    const r = new Array(n);
    const u = mod(BigInt(ethers.hexlify(ethers.randomBytes(32))), N);

    // Start the ring at the signer: c_{j+1} = H(m, uG, u·Hp(P_j))
    c[(signerIndex + 1) % n] = challenge(messageHash, pointMul(u, G), pointMul(u, hp[signerIndex]));

    // Walk the ring with random r_i for everyone else.
    for (let step = 1; step < n; step++) {
      const i = (signerIndex + step) % n;
      r[i] = mod(BigInt(ethers.hexlify(ethers.randomBytes(32))), N);
      const l = pointAdd(pointMul(r[i], G), pointMul(c[i], points[i]));
      const rr = pointAdd(pointMul(r[i], hp[i]), pointMul(c[i], pointFromHex(keyImage)));
      c[(i + 1) % n] = challenge(messageHash, l, rr);
    }

    // Close the ring at the signer: r_j = u − c_j·x (mod n)
    r[signerIndex] = mod(u - c[signerIndex] * x, N);

    return {
      messageHash,
      keyImage,
      c: c.map((v) => '0x' + v.toString(16)),
      r: r.map((v) => '0x' + v.toString(16)),
      pubKeys,
    };
  }

  /** Verify an LSAG signature — true iff the ring equation closes. */
  verifyRingSignature(message, pubKeys, signature) {
    try {
      const points = pubKeys.map(pointFromHex);
      const n = points.length;
      if (signature.c.length !== n || signature.r.length !== n) return false;
      const messageHash = ethers.keccak256(ethers.toUtf8Bytes(message));
      if (signature.messageHash !== messageHash) return false;

      const hp = points.map((pt) => hashToPoint(pointToHex(pt)));
      const image = pointFromHex(signature.keyImage);
      const c = signature.c.map((v) => BigInt(v));
      const r = signature.r.map((v) => BigInt(v));

      let ci = c[0];
      for (let i = 0; i < n; i++) {
        const l = pointAdd(pointMul(r[i], G), pointMul(ci, points[i]));
        const rr = pointAdd(pointMul(r[i], hp[i]), pointMul(ci, image));
        ci = challenge(messageHash, l, rr);
      }
      return ci === c[0];
    } catch (_) {
      return false;
    }
  }
}

export const ringSignatureService = new RingSignatureService();
