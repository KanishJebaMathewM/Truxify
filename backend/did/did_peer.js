import crypto from 'crypto';

/**
 * Decentralized Identity did:peer:2 Engine for Offline Driver Authentication.
 */
export class DidPeer2Engine {
  createDidPeer2(publicKeyHex, endpointUrl) {
    // did:peer:2 spec format using multibase keys and service endpoints
    const encKey = `Vz${publicKeyHex}`;
    const encEndpoint = Buffer.from(endpointUrl).toString('base64url');
    return `did:peer:2.Ez${encKey}.Service~${encEndpoint}`;
  }

  resolveDidPeer2(didString) {
    if (!didString.startsWith('did:peer:2.')) {
      throw new Error('Invalid peer DID format');
    }

    const segments = didString.split('.');
    const keySegment = segments[1];
    const serviceSegment = segments[2];

    const publicKeyHex = keySegment.substring(4); // Strip EzVz (4-char prefix)
    const endpoint = Buffer.from(serviceSegment.split('~')[1], 'base64url').toString('utf8');

    return {
      publicKeyHex,
      endpoint,
      resolvedDocument: {
        id: didString,
        verificationMethod: [
          {
            id: `${didString}#key-1`,
            type: "JsonWebKey2020",
            controller: didString,
            publicKeyHex
          }
        ],
        service: [
          {
            id: `${didString}#service-1`,
            type: "DIDCommMessaging",
            serviceEndpoint: endpoint
          }
        ]
      }
    };
  }
}

export const didPeer2Engine = new DidPeer2Engine();
