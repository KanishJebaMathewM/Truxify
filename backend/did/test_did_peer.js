import { didPeer2Engine } from './did_peer.js';
import assert from 'assert';

console.log('Testing did:peer:2 Identity Engine...');

const pubKey = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const endpoint = 'https://api.truxify.com/didcomm';

const did = didPeer2Engine.createDidPeer2(pubKey, endpoint);
assert.match(did, /^did:peer:2\.Ez[1-9A-HJ-NP-Za-km-z]+\.S[A-Za-z0-9_-]+$/);
assert.strictEqual(did.includes('.Service~'), false);
assert.strictEqual(did.includes('Vz000102'), false);

const keySegment = did.split('.')[1];
assert.strictEqual(keySegment[0], 'E');
assert.strictEqual(keySegment[1], 'z');

const serviceSegment = did.split('.')[2];
assert.strictEqual(serviceSegment[0], 'S');
const decodedService = JSON.parse(Buffer.from(serviceSegment.slice(1), 'base64url').toString('utf8'));
assert.deepStrictEqual(decodedService, {
  t: 'dm',
  s: { uri: endpoint }
});

const resolved = didPeer2Engine.resolveDidPeer2(did);
assert.strictEqual(resolved.publicKeyHex, pubKey);
assert.strictEqual(resolved.endpoint, endpoint);
assert.strictEqual(resolved.resolvedDocument.id, did);
assert.strictEqual(resolved.resolvedDocument.verificationMethod[0].type, 'Multikey');
assert.strictEqual(resolved.resolvedDocument.verificationMethod[0].controller, did);
assert.strictEqual(resolved.resolvedDocument.verificationMethod[0].publicKeyMultibase, keySegment.slice(1));
assert.deepStrictEqual(resolved.resolvedDocument.keyAgreement, [`${did}#key-1`]);
assert.deepStrictEqual(resolved.resolvedDocument.service[0].serviceEndpoint, { uri: endpoint });

assert.throws(
  () => didPeer2Engine.createDidPeer2('02b4632d08485ff1ff2dbefb8f2d547f20dc00a5', endpoint),
  /exactly 32 bytes/
);

assert.throws(
  () => didPeer2Engine.resolveDidPeer2(`${did}x`),
  /base64url JSON|Invalid peer DID format|Peer DID service/
);

console.log('✅ did:peer:2 standards encoding and offline resolution tests passed.');
