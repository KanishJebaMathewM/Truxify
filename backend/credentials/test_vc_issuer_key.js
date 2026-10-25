import assert from 'assert';
import crypto from 'crypto';
import { W3cCredentialIssuer } from './vc_issuer.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const originalNodeEnv = process.env.NODE_ENV;
const originalPrivateKey = process.env.TRUXIFY_VC_PRIVATE_KEY;

try {
  process.env.NODE_ENV = 'production';
  delete process.env.TRUXIFY_VC_PRIVATE_KEY;

  assert.throws(
    () => new W3cCredentialIssuer(),
    /TRUXIFY_VC_PRIVATE_KEY is required in production/
  );

  process.env.TRUXIFY_VC_PRIVATE_KEY = privateKeyPem;
  const issuerBeforeRestart = new W3cCredentialIssuer();
  const vc = issuerBeforeRestart.issueDriverCredential('DRV_PERSIST', {
    name: 'Persistent Issuer Test'
  });

  const issuerAfterRestart = new W3cCredentialIssuer(privateKeyPem, undefined);
  assert.strictEqual(issuerAfterRestart.verifyCredentialProof(vc), true);
  assert.strictEqual(
    issuerAfterRestart.publicKey.export({ type: 'spki', format: 'der' }).equals(
      publicKey.export({ type: 'spki', format: 'der' })
    ),
    true
  );

  console.log('✅ VC issuer key persistence tests passed.');
} finally {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;

  if (originalPrivateKey === undefined) delete process.env.TRUXIFY_VC_PRIVATE_KEY;
  else process.env.TRUXIFY_VC_PRIVATE_KEY = originalPrivateKey;
}
