import { didPeer2Engine } from './did_peer.js';
import assert from 'assert';

console.log('Testing did:peer:2 Identity Engine...');

const pubKey = '02b4632d08485ff1ff2dbefb8f2d547f20dc00a5';
const endpoint = 'https://api.truxify.com/didcomm';

const did = didPeer2Engine.createDidPeer2(pubKey, endpoint);
assert.strictEqual(did.startsWith('did:peer:2.E'), true);

const resolved = didPeer2Engine.resolveDidPeer2(did);
assert.strictEqual(resolved.publicKeyHex, pubKey);
assert.strictEqual(resolved.endpoint, endpoint);
assert.strictEqual(resolved.resolvedDocument.verificationMethod[0].publicKeyHex, pubKey);

console.log('✅ did:peer:2 offline resolution test passed.');
