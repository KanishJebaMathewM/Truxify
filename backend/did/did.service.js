import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import logger from '../../api/src/middleware/logger.js';
import { supabase } from '../../api/src/config/db.js';

class DIDService {
    constructor() {
        this.provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
        this.didRegistryAddress = process.env.DID_REGISTRY_ADDRESS;
        this.identityWalletAddress = process.env.IDENTITY_WALLET_ADDRESS;

        this.didRegistryABI = [
            'function createDID(string memory did) external',
            'function deactivateDID(string memory did) external',
            'function addServiceEndpoint(string memory did, string memory id, string memory type, string memory serviceEndpoint, string memory description) external',
            'function addVerificationMethod(string memory did, string memory id, string memory type, string memory controller, string memory publicKeyMultibase) external',
            'function issueCredential(address subject, string memory credentialType, bytes32 schemaHash, uint256 validUntil, bytes32 proofHash) external returns (bytes32)',
            'function revokeCredential(bytes32 credentialId) external',
            'function verifyCredential(bytes32 credentialId) external view returns (bool)',
            'function getDID(string memory did) external view returns (address, string, bool, uint256, uint256)',
            'function getCredential(bytes32 credentialId) external view returns (tuple(bytes32, address, address, string, bytes32, uint256, uint256, bool, bytes32))',
            'function isDIDActive(string memory did) external view returns (bool)'
        ];

        this.identityWalletABI = [
            'function createWallet(string memory did) external',
            'function addCredential(bytes32 credentialId) external',
            'function removeCredential(bytes32 credentialId) external',
            'function getWallet(address owner) external view returns (address, string, bytes32[], bool, uint256, uint256)',
            'function getCredentials(address owner) external view returns (bytes32[])',
            'function isWalletActive(address owner) external view returns (bool)'
        ];

        this.didRegistry = new ethers.Contract(
            this.didRegistryAddress,
            this.didRegistryABI,
            this.wallet
        );

        this.identityWallet = new ethers.Contract(
            this.identityWalletAddress,
            this.identityWalletABI,
            this.wallet
        );

        logger.info('✅ DID Service initialized');
    }

    async createDID(userAddress) {
        try {
            const did = `did:truxify:${uuidv4()}`;

            const tx = await this.didRegistry.createDID(did);
            const receipt = await tx.wait();

            await this.addServiceEndpoint(did, 'identity', 'IdentityService', `${process.env.API_URL}/api/did/identity`, 'Main identity service');
            await this.addServiceEndpoint(did, 'credentials', 'CredentialService', `${process.env.API_URL}/api/did/credentials`, 'Credential management service');

            const keyPair = crypto.generateKeyPairSync('rsa', {
                modulusLength: 2048,
                publicKeyEncoding: { type: 'spki', format: 'pem' },
                privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
            });
            const publicKeyMultibase = Buffer.from(keyPair.publicKey).toString('base64');
            await this.addVerificationMethod(did, 'key-1', 'RsaVerificationKey2018', did, publicKeyMultibase);

            await this.identityWallet.createWallet(did);

            await this.storeDID({ did, owner: userAddress, publicKey: publicKeyMultibase });

            logger.info(`✅ DID created: ${did}`);
            return { success: true, did, publicKey: publicKeyMultibase, txHash: receipt.hash };
        } catch (error) {
            logger.error('DID creation failed:', error);
            throw error;
        }
    }

    async addServiceEndpoint(did, id, type, endpoint, description) {
        try {
            const tx = await this.didRegistry.addServiceEndpoint(did, id, type, endpoint, description);
            await tx.wait();
            return { success: true };
        } catch (error) {
            logger.error('Service endpoint addition failed:', error);
            throw error;
        }
    }

    async addVerificationMethod(did, id, type, controller, publicKey) {
        try {
            const tx = await this.didRegistry.addVerificationMethod(did, id, type, controller, publicKey);
            await tx.wait();
            return { success: true };
        } catch (error) {
            logger.error('Verification method addition failed:', error);
            throw error;
        }
    }

    async issueCredential(subject, credentialType, schema, validUntil) {
        try {
            const schemaHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(schema)));
            const proof = this.generateProof(subject, credentialType, schema);
            const proofHash = ethers.keccak256(ethers.toUtf8Bytes(proof));

            const validUntilTimestamp = validUntil || Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

            const tx = await this.didRegistry.issueCredential(
                subject,
                credentialType,
                schemaHash,
                validUntilTimestamp,
                proofHash
            );
            const receipt = await tx.wait();

            const credentialId = ethers.keccak256(
                ethers.toUtf8Bytes(`${Date.now()}:${this.wallet.address}:${subject}:${credentialType}`)
            );

            await this.identityWallet.addCredential(credentialId);

            await this.storeCredential({
                credentialId,
                subject,
                credentialType,
                schema,
                issuedAt: new Date().toISOString(),
                validUntil: new Date(validUntilTimestamp * 1000).toISOString(),
                txHash: receipt.hash,
                proof
            });

            logger.info(`✅ Credential issued: ${credentialId}`);
            return { success: true, credentialId };
        } catch (error) {
            logger.error('Credential issuance failed:', error);
            throw error;
        }
    }

    async verifyCredential(credentialId) {
        try {
            const isValid = await this.didRegistry.verifyCredential(credentialId);
            const credential = await this.didRegistry.getCredential(credentialId);

            return {
                success: true,
                isValid,
                credential: {
                    id: credential[0],
                    issuer: credential[1],
                    subject: credential[2],
                    type: credential[3],
                    issuedAt: credential[5].toString(),
                    validUntil: credential[6].toString(),
                    revoked: credential[7]
                }
            };
        } catch (error) {
            logger.error('Credential verification failed:', error);
            throw error;
        }
    }

    async revokeCredential(credentialId) {
        try {
            const tx = await this.didRegistry.revokeCredential(credentialId);
            const receipt = await tx.wait();

            await this.updateCredentialStatus(credentialId, true);

            logger.info(`✅ Credential revoked: ${credentialId}`);
            return { success: true, credentialId };
        } catch (error) {
            logger.error('Credential revocation failed:', error);
            throw error;
        }
    }

    generateProof(subject, credentialType, schema) {
        const secret = process.env.DID_PROOF_SECRET || 'default-proof-secret';
        const payload = JSON.stringify({ subject, credentialType, schema, timestamp: Date.now() });
        const proof = crypto.createHmac('sha256', secret).update(payload).digest('hex');
        return proof;
    }

    async getDID(did) {
        try {
            const didData = await this.didRegistry.getDID(did);
            return { did, owner: didData[0], isActive: didData[2], createdAt: didData[3].toString(), updatedAt: didData[4].toString() };
        } catch (error) {
            logger.error('DID fetch failed:', error);
            return null;
        }
    }

    async getWallet(address) {
        try {
            const walletData = await this.identityWallet.getWallet(address);
            return { owner: walletData[0], did: walletData[1], credentials: walletData[2], isActive: walletData[3] };
        } catch (error) {
            logger.error('Wallet fetch failed:', error);
            return null;
        }
    }

    async getCredentials(address) {
        try {
            const credentials = await this.identityWallet.getCredentials(address);
            const credDetails = [];

            for (const credId of credentials) {
                const details = await this.didRegistry.getCredential(credId);
                credDetails.push({
                    id: details[0],
                    issuer: details[1],
                    subject: details[2],
                    type: details[3],
                    issuedAt: details[5].toString(),
                    validUntil: details[6].toString(),
                    revoked: details[7]
                });
            }

            return credDetails;
        } catch (error) {
            logger.error('Credentials fetch failed:', error);
            return [];
        }
    }

    async storeDID(data) {
        const { error } = await supabase
            .from('dids')
            .insert([{ did: data.did, owner: data.owner, public_key: data.publicKey, created_at: new Date().toISOString() }]);
        if (error) throw error;
    }

    async storeCredential(data) {
        const { error } = await supabase
            .from('credentials')
            .insert([{
                credential_id: data.credentialId,
                subject: data.subject,
                credential_type: data.credentialType,
                schema: data.schema,
                issued_at: data.issuedAt,
                valid_until: data.validUntil,
                tx_hash: data.txHash,
                proof: data.proof
            }]);
        if (error) throw error;
    }

    async updateCredentialStatus(credentialId, revoked) {
        const { error } = await supabase
            .from('credentials')
            .update({ revoked, revoked_at: new Date().toISOString() })
            .eq('credential_id', credentialId);
        if (error) throw error;
    }

    async getDIDStats() {
        const { data: dids, error: didsErr } = await supabase.from('dids').select('*').order('created_at', { ascending: false }).limit(100);
        const { data: credentials, error: credsErr } = await supabase.from('credentials').select('*').order('issued_at', { ascending: false }).limit(100);

        if (didsErr || credsErr) {
            logger.error('Failed to fetch DID stats', { didsErr, credsErr });
        }

        const safeDids = dids || [];
        const safeCreds = credentials || [];

        return {
            totalDIDs: safeDids.length,
            activeDIDs: safeDids.filter(d => d.is_active !== false).length,
            totalCredentials: safeCreds.length,
            revokedCredentials: safeCreds.filter(c => c.revoked === true).length
        };
    }
}

export default new DIDService();