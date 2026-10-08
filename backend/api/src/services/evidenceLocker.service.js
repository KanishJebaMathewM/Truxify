const axios = require('axios');
const crypto = require('crypto');

class EvidenceLockerService {
    constructor() {
        
        this.pinataApiKey = process.env.PINATA_API_KEY;
        this.pinataSecretApiKey = process.env.PINATA_SECRET_API_KEY;
        this.pinataApiUrl = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';
    }

    
    async lockEvidence(evidenceData, disputeId) {
        try {
            if (!this.pinataApiKey || !this.pinataSecretApiKey) {
                throw new Error('IPFS credentials (PINATA) are not configured in environment.');
            }

            const dataString = JSON.stringify(evidenceData);
            const dataHash = crypto.createHash('sha256').update(dataString).digest('hex');

            const payload = {
                pinataOptions: {
                    cidVersion: 1
                },
                pinataMetadata: {
                    name: `Dispute_Evidence_${disputeId}`,
                    keyvalues: {
                        disputeId: disputeId,
                        integrityHash: dataHash,
                        timestamp: new Date().toISOString()
                    }
                },
                pinataContent: evidenceData
            };

            
            const response = await axios.post(this.pinataApiUrl, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    pinata_api_key: this.pinataApiKey,
                    pinata_secret_api_key: this.pinataSecretApiKey
                }
            });

            return {
                success: true,
                disputeId: disputeId,
                cid: response.data.IpfsHash, 
                integrityHash: dataHash,
                gatewayUrl: `https://gateway.pinata.cloud/ipfs/${response.data.IpfsHash}`,
                message: 'Evidence successfully locked on decentralized storage.'
            };
            
        } catch (error) {
            console.error(`[EvidenceLocker] Failed to store evidence for dispute ${disputeId}:`, error.message);
            throw new Error('Failed to push evidence to IPFS/Arweave storage.');
        }
    }
}

module.exports = new EvidenceLockerService();
