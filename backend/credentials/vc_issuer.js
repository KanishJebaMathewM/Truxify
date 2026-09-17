import crypto from 'crypto';

/**
 * W3C Verifiable Credentials (VC) Issuer & Status List 2021 Revocation Engine.
 */
export class W3cCredentialIssuer {
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

    // Sign the VC using mock Ed25519Signature2020 signature suite
    const vcString = JSON.stringify(vc);
    const signature = crypto.createHash('sha256').update(vcString).digest('hex');
    
    vc.proof = {
      "type": "Ed25519Signature2020",
      "created": new Date().toISOString(),
      "verificationMethod": "did:truxify:authority#key-1",
      "proofPurpose": "assertionMethod",
      "proofValue": signature
    };

    return vc;
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
