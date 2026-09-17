import crypto from 'crypto';

/**
 * W3C Verifiable Credentials (VC) Issuer & Status List 2021 Revocation Engine.
 */
export class W3cCredentialIssuer {
  constructor(privateKeyPem = process.env.TRUXIFY_VC_PRIVATE_KEY) {
    if (privateKeyPem) {
      this.privateKey = crypto.createPrivateKey(privateKeyPem);
      this.publicKey = crypto.createPublicKey(this.privateKey);
    } else {
      const keyPair = crypto.generateKeyPairSync('ed25519');
      this.privateKey = keyPair.privateKey;
      this.publicKey = keyPair.publicKey;
    }
  }

  issueDriverCredential(driverId, attributes) {
    const vc = {
      "@context": [
        "https://www.w3.org/2018/credentials/v1",
        "https://schema.org"
      ],
      "id": `urn:uuid:${crypto.randomUUID()}`,
      "type": ["VerifiableCredential", "DriverLicenseCredential"],
      "issuer": "did:truxify:authority",
      "issuanceDate": new Date().toISOString(),
      "credentialSubject": {
        "id": `did:truxify:${driverId}`,
        ...attributes
      },
      "credentialStatus": {
        "id": "https://api.truxify.com/status/list/2021#0",
        "type": "StatusList2021Entry",
        "statusPurpose": "revocation",
        "statusListIndex": "0"
      }
    };

    const vcString = JSON.stringify(vc);
    const signature = crypto.sign(null, Buffer.from(vcString), this.privateKey).toString('hex');

    vc.proof = {
      "type": "Ed25519Signature2020",
      "created": new Date().toISOString(),
      "verificationMethod": "did:truxify:authority#key-1",
      "proofPurpose": "assertionMethod",
      "proofValue": signature
    };

    return vc;
  }

  verifyCredentialProof(vc) {
    if (!vc || typeof vc !== 'object' || !vc.proof || typeof vc.proof.proofValue !== 'string') {
      return false;
    }

    const proofValue = vc.proof.proofValue;
    if (!/^[0-9a-fA-F]{128}$/.test(proofValue)) {
      return false;
    }

    const credential = { ...vc };
    delete credential.proof;

    return crypto.verify(
      null,
      Buffer.from(JSON.stringify(credential)),
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
