import crypto from 'crypto';

const BASE58BTC_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const KEY_PREFIX = 0xec; // x25519-pub multicodec

function base58btcEncode(bytes) {
  let value = BigInt(`0x${Buffer.from(bytes).toString('hex')}`);
  let encoded = '';
  while (value > 0n) {
    const remainder = Number(value % 58n);
    value /= 58n;
    encoded = BASE58BTC_ALPHABET[remainder] + encoded;
  }

  let leadingZeroes = 0;
  for (const byte of bytes) {
    if (byte !== 0) break;
    leadingZeroes += 1;
  }

  return `${'1'.repeat(leadingZeroes)}${encoded}` || '1';
}

function base58btcDecode(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Invalid base58btc value');
  }

  let numericValue = 0n;
  for (const character of value) {
    const digit = BASE58BTC_ALPHABET.indexOf(character);
    if (digit < 0) throw new Error('Invalid base58btc value');
    numericValue = numericValue * 58n + BigInt(digit);
  }

  const hex = numericValue.toString(16).padStart(numericValue === 0n ? 0 : 2, '0');
  const decoded = numericValue === 0n ? Buffer.alloc(0) : Buffer.from(hex.length % 2 ? `0${hex}` : hex, 'hex');

  let leadingOnes = 0;
  for (const character of value) {
    if (character !== '1') break;
    leadingOnes += 1;
  }

  return Buffer.concat([Buffer.alloc(leadingOnes), decoded]);
}

function encodeMultibaseX25519PublicKey(publicKeyHex) {
  if (!/^[0-9a-fA-F]{64}$/.test(publicKeyHex)) {
    throw new TypeError('X25519 public key must be exactly 32 bytes of hexadecimal data');
  }

  return `z${base58btcEncode(Buffer.concat([Buffer.from([KEY_PREFIX]), Buffer.from(publicKeyHex, 'hex')]))}`;
}

function decodeMultibaseX25519PublicKey(multibaseKey) {
  if (typeof multibaseKey !== 'string' || !multibaseKey.startsWith('z')) {
    throw new Error('Peer DID key must use base58btc multibase encoding');
  }

  const decoded = base58btcDecode(multibaseKey.slice(1));
  if (decoded.length !== 33 || decoded[0] !== KEY_PREFIX) {
    throw new Error('Peer DID key must be a 32-byte x25519-pub multicodec value');
  }

  return decoded.subarray(1).toString('hex');
}

function encodeService(endpointUrl) {
  if (typeof endpointUrl !== 'string' || endpointUrl.length === 0) {
    throw new TypeError('Service endpoint must be a non-empty string');
  }

  const service = JSON.stringify({
    t: 'dm',
    s: { uri: endpointUrl }
  });

  return `S${Buffer.from(service, 'utf8').toString('base64url')}`;
}

function decodeService(serviceSegment) {
  if (typeof serviceSegment !== 'string' || !serviceSegment.startsWith('S')) {
    throw new Error('Peer DID service must use the .S base64url encoding');
  }

  let service;
  try {
    service = JSON.parse(Buffer.from(serviceSegment.slice(1), 'base64url').toString('utf8'));
  } catch {
    throw new Error('Peer DID service is not valid base64url JSON');
  }

  if (!service || service.t !== 'dm' || !service.s || typeof service.s.uri !== 'string' || service.s.uri.length === 0) {
    throw new Error('Peer DID service does not contain a valid DIDComm messaging endpoint');
  }

  return service.s.uri;
}

/**
 * Decentralized Identity did:peer:2 Engine for Offline Driver Authentication.
 *
 * Method 2 uses multicodec + multibase keys and individually encoded service
 * blocks as defined by the Peer DID Method Specification.
 */
export class DidPeer2Engine {
  createDidPeer2(publicKeyHex, endpointUrl) {
    const encodedKey = encodeMultibaseX25519PublicKey(publicKeyHex);
    const encodedService = encodeService(endpointUrl);
    return `did:peer:2.E${encodedKey}.${encodedService}`;
  }

  resolveDidPeer2(didString) {
    if (typeof didString !== 'string' || !didString.startsWith('did:peer:2.')) {
      throw new Error('Invalid peer DID format');
    }

    const segments = didString.slice('did:peer:2'.length).split('.').filter(Boolean);
    if (segments.length < 2) {
      throw new Error('Peer DID must contain at least one key and one service');
    }

    const keySegments = segments.filter((segment) => segment[0] === 'E' || segment[0] === 'V' || segment[0] === 'A' || segment[0] === 'I' || segment[0] === 'D');
    const serviceSegments = segments.filter((segment) => segment[0] === 'S');

    if (keySegments.length !== 1 || serviceSegments.length !== 1 || keySegments[0][0] !== 'E') {
      throw new Error('This resolver expects one X25519 encryption key and one service');
    }

    const multibaseKey = keySegments[0].slice(1);
    const publicKeyHex = decodeMultibaseX25519PublicKey(multibaseKey);
    const endpoint = decodeService(serviceSegments[0]);

    const keyId = `${didString}#key-1`;
    const serviceId = `${didString}#service`;

    return {
      publicKeyHex,
      endpoint,
      resolvedDocument: {
        '@context': [
          'https://www.w3.org/ns/did/v1',
          'https://w3id.org/security/multikey/v1'
        ],
        id: didString,
        verificationMethod: [
          {
            id: keyId,
            type: 'Multikey',
            controller: didString,
            publicKeyMultibase: multibaseKey
          }
        ],
        keyAgreement: [keyId],
        service: [
          {
            id: serviceId,
            type: 'DIDCommMessaging',
            serviceEndpoint: {
              uri: endpoint
            }
          }
        ]
      }
    };
  }
}

export const didPeer2Engine = new DidPeer2Engine();
