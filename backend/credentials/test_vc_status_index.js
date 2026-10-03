import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { W3cCredentialIssuer } from './vc_issuer.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'truxify-vc-status-'));
const stateFile = path.join(tempDir, 'status-index.json');

try {
  const issuerA = new W3cCredentialIssuer(undefined, stateFile);
  const credentials = [
    issuerA.issueDriverCredential('DRV_01', { name: 'Driver One' }),
    issuerA.issueDriverCredential('DRV_02', { name: 'Driver Two' }),
    issuerA.issueDriverCredential('DRV_03', { name: 'Driver Three' }),
  ];

  assert.deepStrictEqual(
    credentials.map((credential) => credential.credentialStatus.statusListIndex),
    ['0', '1', '2']
  );

  assert.deepStrictEqual(
    credentials.map((credential) => credential.credentialStatus.id),
    [
      'https://api.truxify.com/status/list/2021#0',
      'https://api.truxify.com/status/list/2021#1',
      'https://api.truxify.com/status/list/2021#2',
    ]
  );

  const issuerB = new W3cCredentialIssuer(undefined, stateFile);
  const persistedCredential = issuerB.issueDriverCredential('DRV_04', { name: 'Driver Four' });
  assert.strictEqual(persistedCredential.credentialStatus.statusListIndex, '3');

  console.log('✅ VC status-list index allocation tests passed.');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
