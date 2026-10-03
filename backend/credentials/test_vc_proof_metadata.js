import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { W3cCredentialIssuer } from './vc_issuer.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'truxify-vc-proof-'));
const stateFile = path.join(tempDir, 'status-index.json');

try {
  const issuer = new W3cCredentialIssuer(undefined, stateFile);
  const vc = issuer.issueDriverCredential('DRV_METADATA', {
    name: 'Metadata Driver',
    licenseCategory: 'Heavy Vehicle',
  });

  assert.strictEqual(issuer.verifyCredentialProof(vc), true);

  for (const field of ['type', 'created', 'verificationMethod', 'proofPurpose']) {
    const tampered = JSON.parse(JSON.stringify(vc));
    if (field === 'created') {
      tampered.proof[field] = new Date(Date.parse(tampered.proof[field]) + 1000).toISOString();
    } else if (field === 'type') {
      tampered.proof[field] = 'OtherSignatureSuite';
    } else if (field === 'verificationMethod') {
      tampered.proof[field] = 'did:truxify:authority#key-evil';
    } else {
      tampered.proof[field] = 'authentication';
    }

    assert.strictEqual(
      issuer.verifyCredentialProof(tampered),
      false,
      `tampered proof.${field} must fail verification`
    );
  }

  const tamperedCredential = JSON.parse(JSON.stringify(vc));
  tamperedCredential.credentialSubject.name = 'Modified Driver';
  assert.strictEqual(issuer.verifyCredentialProof(tamperedCredential), false);

  const extraField = JSON.parse(JSON.stringify(vc));
  extraField.proof.untrustedField = 'should-not-be-accepted';
  assert.strictEqual(issuer.verifyCredentialProof(extraField), false);

  const credentials = [
    issuer.issueDriverCredential('DRV_01', { name: 'Driver One' }),
    issuer.issueDriverCredential('DRV_02', { name: 'Driver Two' }),
  ];
  assert.deepStrictEqual(
    credentials.map((credential) => credential.credentialStatus.statusListIndex),
    ['1', '2']
  );

  const restartedIssuer = new W3cCredentialIssuer(undefined, stateFile);
  const persistedCredential = restartedIssuer.issueDriverCredential('DRV_03', { name: 'Driver Three' });
  assert.strictEqual(persistedCredential.credentialStatus.statusListIndex, '3');
  assert.strictEqual(restartedIssuer.verifyCredentialProof(persistedCredential), true);

  console.log('✅ VC proof metadata binding and status-list allocation tests passed.');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
