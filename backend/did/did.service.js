import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import logger from '../api/src/middleware/logger.js';
import { supabase, supabaseAdmin } from '../api/src/config/db.js';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58btc(input) {
    const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
    let zeros = 0;
    while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
    let digits = [0];
    for (const byte of bytes) {
        let carry = byte;
        for (let i = 0; i < digits.length; i++) {
            carry += digits[i] << 8;
            digits[i] = carry % 58;
            carry = (carry / 58) | 0;
        }
        while (carry > 0) {
            digits.push(carry % 58);
            carry = (carry / 58) | 0;
        }
    }
    let output = '';
    for (let i = 0; i < zeros; i++) output += '1';
    for (let i = digits.length - 1; i >= 0; i--) output += BASE58_ALPHABET[digits[i]];
    return output;
}

class DIDService {
    constructor() {
        if (!process.env.DID_PROOF_SECRET) {
            throw new Error('DID_PROOF_SECRET environment variable is required and must not be empty');
        }
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
            'function isDIDActive(string memory did) external view returns (bool)',
            'event CredentialIssued(bytes32 indexed credentialId, address issuer, address subject)'
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

    async createDID(userAddress, publicKey) {
        try {
            const did = `did:truxify:${uuidv4()}`;

            const tx = await this.didRegistry.createDID(did);
            const receipt = await tx.wait();

            await this.addServiceEndpoint(did, 'identity', 'IdentityService', `${process.env.API_URL}/api/did/identity`, 'Main identity service');
            await this.addServiceEndpoint(did, 'credentials', 'CredentialService', `${process.env.API_URL}/api/did/credentials`, 'Credential management service');

            let publicKeyMultibase = publicKey;
            let privateKey = null;
            if (!publicKeyMultibase) {
                const keyPair = crypto.generateKeyPairSync('rsa', {
                    modulusLength: 2048,
                    publicKeyEncoding: { type: 'spki', format: 'der' },
                    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
                });
                publicKeyMultibase = `z${base58btc(keyPair.publicKey)}`;
                privateKey = Buffer.from(keyPair.privateKey).toString('base64');
            }
            await this.addVerificationMethod(did, 'key-1', 'RsaVerificationKey2018', did, publicKeyMultibase);

            await this.identityWallet.createWallet(did);

            await this.storeDID({ did, owner: userAddress, publicKey: publicKeyMultibase });

            logger.info(`✅ DID created: ${did}`);
            return { success: true, did, publicKey: publicKeyMultibase, privateKey, txHash: receipt.hash };
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
            const issuedAtMs = Date.now();
            const schemaHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(schema)));
            const proof = this.generateProof(subject, credentialType, schema, issuedAtMs);
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

            // Read the exact on-chain credentialId from the CredentialIssued
            // event so it always matches the contract's own derivation.
            let credentialId = null;
            for (const log of receipt.logs) {
                try {
                    const parsed = this.didRegistry.interface.parseLog(log);
                    if (parsed && parsed.name === 'CredentialIssued') {
                        credentialId = parsed.args[0];
                        break;
                    }
                } catch {
                    // Not a DIDRegistry log; keep scanning.
                }
            }

            if (!credentialId) {
                // Fallback: reproduce abi.encodePacked(block.timestamp, msg.sender,
                // subject, credentialType) using the actual block timestamp.
                const block = await this.provider.getBlock(receipt.blockNumber);
                credentialId = ethers.keccak256(
                    ethers.solidityPacked(
                        ["uint256", "address", "address", "string"],
                        [block.timestamp, this.wallet.address, subject, credentialType]
                    )
                );
            }

            await this.identityWallet.addCredential(credentialId);

            await this.storeCredential({
                credentialId,
                subject,
                credentialType,
                schema,
                issuedAt: new Date(issuedAtMs).toISOString(),
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

    generateProof(subject, credentialType, schema, issuedAtMs) {
        const secret = process.env.DID_PROOF_SECRET;
        if (!secret) {
            throw new Error('DID_PROOF_SECRET is not configured; refusing to generate proof');
        }
        const payload = JSON.stringify({ subject, credentialType, schema, timestamp: issuedAtMs });
        return crypto.createHmac('sha256', secret).update(payload).digest('hex');
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
        const { error } = await (supabaseAdmin || supabase)
            .from('dids')
            .insert([{
                did: data.did,
                owner: data.owner,
                public_key: data.publicKey,
                is_active: true,
                created_at: new Date().toISOString()
            }]);
        if (error) throw error;
    }

    async updateDIDStatus(did, isActive) {
        const { error } = await (supabaseAdmin || supabase)
            .from('dids')
            .update({ is_active: isActive, updated_at: new Date().toISOString() })
            .eq('did', did);
        if (error) throw error;
    }

    async deactivateDID(did) {
        try {
            const tx = await this.didRegistry.deactivateDID(did);
            await tx.wait();

            await this.updateDIDStatus(did, false);

            logger.info(`✅ DID deactivated: ${did}`);
            return { success: true, did };
        } catch (error) {
            logger.error('DID deactivation failed:', error);
            throw error;
        }
    }

    async storeCredential(data) {
        const { error } = await (supabaseAdmin || supabase)
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
        const { error } = await (supabaseAdmin || supabase)
            .from('credentials')
            .update({ revoked, revoked_at: new Date().toISOString() })
            .eq('credential_id', credentialId);
        if (error) throw error;
    }

    async getDIDStats() {
        const client = supabaseAdmin || supabase;

        const [totalDids, activeDids, totalCreds, revokedCreds] = await Promise.all([
            client.from('dids').select('id', { count: 'exact', head: true }),
            client.from('dids').select('id', { count: 'exact', head: true }).eq('is_active', true),
            client.from('credentials').select('id', { count: 'exact', head: true }),
            client.from('credentials').select('id', { count: 'exact', head: true }).eq('revoked', true)
        ]);

        const errors = [totalDids, activeDids, totalCreds, revokedCreds]
            .filter((result) => result.error)
            .map((result) => result.error);
        if (errors.length > 0) {
            logger.error('Failed to fetch DID stats', errors);
        }

        return {
            totalDIDs: totalDids.error ? 0 : (totalDids.count ?? 0),
            activeDIDs: activeDids.error ? 0 : (activeDids.count ?? 0),
            totalCredentials: totalCreds.error ? 0 : (totalCreds.count ?? 0),
            revokedCredentials: revokedCreds.error ? 0 : (revokedCreds.count ?? 0)
        };
    }
}

export default new DIDService();