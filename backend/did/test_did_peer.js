
import { didPeer2Engine } from './did_peer.js';
import assert from 'node:assert/strict';

console.log('Testing did:peer:2 Identity Engine...');

const pubKey =
  '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';

const endpoint = 'https://api.truxify.com/didcomm';

// Create DID
const did = didPeer2Engine.createDidPeer2(pubKey, endpoint);

assert.match(
  did,
  /^did:peer:2\.Ez[1-9A-HJ-NP-Za-km-z]+\.S[A-Za-z0-9_-]+$/
);

// Validate DID format
assert.equal(did.includes('.Service~'), false);
assert.equal(did.includes('Vz000102'), false);

const segments = did.split('.');

assert.equal(segments.length, 3);
assert.equal(segments[1][0], 'E');
assert.equal(segments[1][1], 'z');
assert.equal(segments[2][0], 'S');

// Decode service information
const decodedService = JSON.parse(
  Buffer.from(segments[2].slice(1), 'base64url').toString('utf8')
);

assert.deepEqual(decodedService, {
  t: 'dm',
  s: { uri: endpoint }
});

// Resolve DID
const resolved = didPeer2Engine.resolveDidPeer2(did);

assert.equal(resolved.publicKeyHex, pubKey);
assert.equal(resolved.endpoint, endpoint);
assert.equal(resolved.resolvedDocument.id, did);

const verificationMethod =
  resolved.resolvedDocument.verificationMethod[0];

assert.equal(verificationMethod.type, 'Multikey');
assert.equal(verificationMethod.controller, did);
assert.equal(verificationMethod.publicKeyMultibase, segments[1].slice(1));

assert.deepEqual(
  resolved.resolvedDocument.keyAgreement,
  [`${did}#key-1`]
);

assert.deepEqual(
  resolved.resolvedDocument.service[0].serviceEndpoint,
  { uri: endpoint }
);

// Invalid public key test
assert.throws(
  () => didPeer2Engine.createDidPeer2(
    '02b4632d08485ff1ff2dbefb8f2d547f20dc00a5',
    endpoint
  ),
  /exactly 32 bytes/
);

// Invalid DID test
assert.throws(
  () => didPeer2Engine.resolveDidPeer2(`${did}x`),
  /base64url JSON|Invalid peer DID format|Peer DID service/
);

console.log(
  '✅ All did:peer:2 encoding and offline resolution tests passed.'
);
