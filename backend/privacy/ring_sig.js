import { ethers } from 'ethers';

// Secp256k1 curve parameters
const P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn;
const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
const Gx = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n;
const Gy = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n;

function modInverse(a, m) {
    let [old_r, r] = [a % m, m];
    let [old_s, s] = [1n, 0n];
    while (r !== 0n) {
        const quotient = old_r / r;
        [old_r, r] = [r, old_r - quotient * r];
        [old_s, s] = [s, old_s - quotient * s];
    }
    return (old_s % m + m) % m;
}

function pointAdd(p1, p2) {
    if (!p1) return p2;
    if (!p2) return p1;
    const [x1, y1] = p1;
    const [x2, y2] = p2;
    if (x1 === x2 && y1 !== y2) return null;
    let m;
    if (x1 === x2 && y1 === y2) {
        m = ((3n * x1 * x2) * modInverse(2n * y1, P)) % P;
    } else {
        m = ((y2 - y1) * modInverse(x2 - x1, P)) % P;
    }
    const x3 = (m * m - x1 - x2) % P;
    const y3 = (m * (x1 - x3) - y1) % P;
    return [(x3 % P + P) % P, (y3 % P + P) % P];
}

function pointMultiply(scalar, point) {
    let res = null;
    let addend = point;
    let k = scalar;
    while (k > 0n) {
        if (k & 1n) res = pointAdd(res, addend);
        addend = pointAdd(addend, addend);
        k >>= 1n;
    }
    return res;
}

function pubKeyToPoint(pubKeyHex) {
    const pubKeyBytes = ethers.getBytes(pubKeyHex);
    if (pubKeyBytes.length === 33) {
        const x = BigInt(ethers.hexlify(pubKeyBytes.slice(1)));
        let beta = (x * x * x + 7n) % P;
        let y = modPow(beta, (P + 1n) / 4n, P);
        if ((y % 2n) !== (BigInt(pubKeyBytes[0]) % 2n)) {
            y = P - y;
        }
        return [x, y];
    } else if (pubKeyBytes.length === 65) {
        const x = BigInt(ethers.hexlify(pubKeyBytes.slice(1, 33)));
        const y = BigInt(ethers.hexlify(pubKeyBytes.slice(33, 65)));
        return [x, y];
    }
    throw new Error('Invalid public key format');
}
