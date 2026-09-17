import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const DEFAULT_STATUS_INDEX_FILE = '.truxify-vc-status-index.json';
const VERIFICATION_METHOD = 'did:truxify:authority#key-1';
const PROOF_TYPE = 'Ed25519Signature2020';
const PROOF_PURPOSE = 'assertionMethod';
const SIGNED_PROOF_FIELDS = ['type', 'created', 'verificationMethod', 'proofPurpose'];

const canonicalize = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
};

const createSignedPayload = (credential, proof) => canonicalize({ credential, proof });

class StatusListIndexStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.loaded = false;
    this.nextIndex = 0;
  }

  load() {
    if (this.loaded) return;

    try {
      const state = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!Number.isSafeInteger(state.nextIndex) || state.nextIndex < 0) {
        throw new Error('Invalid status-list index state.');
      }
      this.nextIndex = state.nextIndex;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    this.loaded = true;
  }

  allocate() {
    this.load();

    if (this.nextIndex >= Number.MAX_SAFE_INTEGER) {
      throw new Error('Status-list index space exhausted.');
    }

    const allocatedIndex = this.nextIndex;
    this.nextIndex += 1;

    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });

    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(
      tempPath,
      JSON.stringify({ nextIndex: this.nextIndex }) + '\n',
      'utf8'
    );
    fs.renameSync(tempPath, this.filePath);

    return allocatedIndex;
  }
}

/**
 * W3C Verifiable Credentials (VC) Issuer & Status List 2021 Revocation Engine.
 */
export class W3cCredentialIssuer {
  constructor(
    privateKeyPem = process.env.TRUXIFY_VC_PRIVATE_KEY,
    statusIndexStorePath = process.env.TRUXIFY_VC_STATUS_INDEX_FILE || DEFAULT_STATUS_INDEX_FILE
  ) {
    this.statusIndexStore = new StatusListIndexStore(statusIndexStorePath);

    if (!privateKeyPem) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('TRUXIFY_VC_PRIVATE_KEY is required in production; refusing to generate an ephemeral issuer key.');
      }

      const keyPair = crypto.generateKeyPairSync('ed25519');
      this.privateKey = keyPair.privateKey;
      this.publicKey = keyPair.publicKey;
      return;
    }

    this.privateKey = crypto.createPrivateKey(privateKeyPem);
    this.publicKey = crypto.createPublicKey(this.privateKey);
  }

  issueDriverCredential(driverId, attributes) {
    const statusListIndex = this.statusIndexStore.allocate();
    const issuanceDate = new Date().toISOString();
    const vc = {
      "@context": [
        "https://www.w3.org/2018/credentials/v1",
        "https://schema.org"
      ],
      "id": `urn:uuid:${crypto.randomUUID()}`,
      "type": ["VerifiableCredential", "DriverLicenseCredential"],
      "issuer": "did:truxify:authority",
      "issuanceDate": issuanceDate,
      "credentialSubject": {
        "id": `did:truxify:${driverId}`,
        ...attributes
      },
      "credentialStatus": {
        "id": `https://api.truxify.com/status/list/2021#${statusListIndex}`,
        "type": "StatusList2021Entry",
        "statusPurpose": "revocation",
        "statusListIndex": String(statusListIndex)
      }
    };

    const signedProof = {
      "type": PROOF_TYPE,
      "created": issuanceDate,
      "verificationMethod": VERIFICATION_METHOD,
      "proofPurpose": PROOF_PURPOSE
    };

    const signature = crypto.sign(
      null,
      Buffer.from(createSignedPayload(vc, signedProof), 'utf8'),
      this.privateKey
    ).toString('hex');

    vc.proof = {
      ...signedProof,
      "proofValue": signature
    };

    return vc;
  }

  verifyCredentialProof(vc) {
    if (!vc || typeof vc !== 'object' || !vc.proof || typeof vc.proof !== 'object') {
      return false;
    }

    const proofKeys = Object.keys(vc.proof).sort();
    const expectedKeys = [...SIGNED_PROOF_FIELDS, 'proofValue'].sort();
    if (proofKeys.length !== expectedKeys.length || !proofKeys.every((key, index) => key === expectedKeys[index])) {
      return false;
    }

    const { proofValue, type, created, verificationMethod, proofPurpose } = vc.proof;
    if (
      typeof proofValue !== 'string' || !/^[0-9a-fA-F]{128}$/.test(proofValue) ||
      type !== PROOF_TYPE ||
      typeof created !== 'string' ||
      verificationMethod !== VERIFICATION_METHOD ||
      proofPurpose !== PROOF_PURPOSE
    ) {
      return false;
    }

    const credential = { ...vc };
    delete credential.proof;

    const signedProof = { type, created, verificationMethod, proofPurpose };

    return crypto.verify(
      null,
      Buffer.from(createSignedPayload(credential, signedProof), 'utf8'),
      this.publicKey,
      Buffer.from(proofValue, 'hex')
    );
  }

  isRevoked(statusListBitstringHex, index) {
    const byteIndex = Math.floor(index / 8);
    const bitOffset = index % 8;

    const buffer = Buffer.from(statusListBitstringHex, 'hex');
    if (byteIndex >= buffer.length) return false;

    // Check if bit at index is set to 1 (indicating revoked status)
    return (buffer[byteIndex] & (1 << bitOffset)) !== 0;
  }
}

export const w3cIssuer = new W3cCredentialIssuer();
