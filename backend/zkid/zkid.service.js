import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import logger from '../../api/src/middleware/logger.js';
import { supabase } from '../../api/src/config/db.js';

class ZKIDService {
    constructor() {
        this.provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
        this.zkidAddress = process.env.ZKID_CONTRACT_ADDRESS;

        this.zkidABI = [
            'function createIdentity(bytes32 identityHash) external',
            'function issueCredential(bytes32 identityHash, string memory credentialType, bytes32 schemaHash, bytes32 credentialHash) external',
            'function revokeCredential(bytes32 credentialHash) external',
            'function requestVerification(bytes32 identityHash, bytes32 credentialHash, bytes calldata proofData) external',
            'function createSelectiveDisclosure(bytes32 identityHash, bytes32[] memory disclosedAttributes, address recipient) external',
            'function revokeSelectiveDisclosure(bytes32 disclosureId) external',
            'function getIdentity(bytes32 identityHash) external view returns (tuple(bytes32,address,uint256,uint256,bool,bytes32[]))',
            'function getCredential(bytes32 credentialHash) external view returns (tuple(bytes32,bytes32,string,bytes32,uint256,uint256,bool,address))',
            'function isIdentityActive(bytes32 identityHash) external view returns (bool)',
            'function isCredentialValid(bytes32 credentialHash) external view returns (bool)'
        ];

        this.zkid = new ethers.Contract(this.zkidAddress, this.zkidABI, this.wallet);

        // Generate identity secret
        this.identitySecret = crypto.randomBytes(32);

        logger.info('✅ ZK-ID Service initialized');
    }

    // ============ Identity Management ============

    async createIdentity(userAddress) {
        try {
            // Generate identity hash
            const identityHash = ethers.keccak256(
                ethers.toUtf8Bytes(`${userAddress}:${Date.now()}:${uuidv4()}`)
            );

            const tx = await this.zkid.createIdentity(identityHash, {
                gasLimit: 200000
            });
            const receipt = await tx.wait();

            await this.storeIdentity({
                identityHash,
                userAddress,
                txHash: receipt.hash
            });

            logger.info(`✅ Identity created: ${identityHash}`);
            return {
                success: true,
                identityHash,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Identity creation failed:', error);
            throw error;
        }
    }

    // ============ Credential Management ============

    async issueCredential(identityHash, credentialType, schemaHash) {
        try {
            // Generate credential hash
            const credentialHash = ethers.keccak256(
                ethers.toUtf8Bytes(`${identityHash}:${credentialType}:${Date.now()}`)
            );

            const tx = await this.zkid.issueCredential(
                identityHash,
                credentialType,
                schemaHash || ethers.ZeroHash,
                credentialHash,
                { gasLimit: 150000 }
            );
            const receipt = await tx.wait();

            await this.storeCredential({
                identityHash,
                credentialHash,
                credentialType,
                txHash: receipt.hash
            });

            logger.info(`✅ Credential issued: ${credentialHash}`);
            return {
                success: true,
                credentialHash,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Credential issuance failed:', error);
            throw error;
        }
    }

    async revokeCredential(credentialHash) {
        try {
            const tx = await this.zkid.revokeCredential(credentialHash, {
                gasLimit: 100000
            });
            const receipt = await tx.wait();

            await this.updateCredentialStatus(credentialHash, true);

            logger.info(`✅ Credential revoked: ${credentialHash}`);
            return {
                success: true,
                credentialHash,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Credential revocation failed:', error);
            throw error;
        }
    }

    async verifyCredential(credentialHash) {
        try {
            const isValid = await this.zkid.isCredentialValid(credentialHash);
            const credential = await this.zkid.getCredential(credentialHash);

            return {
                success: true,
                isValid,
                credential: {
                    credentialHash: credential[0],
                    identityHash: credential[1],
                    credentialType: credential[2],
                    schemaHash: credential[3],
                    issuedAt: credential[4].toString(),
                    expiresAt: credential[5].toString(),
                    revoked: credential[6],
                    issuer: credential[7]
                },
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Credential verification failed:', error);
            throw error;
        }
    }

    // ============ Verification Request ============

    async requestVerification(identityHash, credentialHash, proofData) {
        try {
            const tx = await this.zkid.requestVerification(
                identityHash,
                credentialHash,
                proofData || ethers.ZeroHash,
                { gasLimit: 200000 }
            );
            const receipt = await tx.wait();

            const requestId = ethers.keccak256(
                ethers.toUtf8Bytes(`${identityHash}:${credentialHash}:${Date.now()}`)
            );

            await this.storeVerificationRequest({
                requestId,
                identityHash,
                credentialHash,
                txHash: receipt.hash
            });

            logger.info(`✅ Verification requested: ${requestId}`);
            return {
                success: true,
                requestId,
                verified: true,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Verification request failed:', error);
            throw error;
        }
    }

    // ============ Selective Disclosure ============

    async createSelectiveDisclosure(identityHash, disclosedAttributes, recipient) {
        try {
            const tx = await this.zkid.createSelectiveDisclosure(
                identityHash,
                disclosedAttributes,
                recipient,
                { gasLimit: 150000 }
            );
            const receipt = await tx.wait();

            const disclosureId = ethers.keccak256(
                ethers.toUtf8Bytes(`${identityHash}:${Date.now()}:${recipient}`)
            );

            await this.storeSelectiveDisclosure({
                disclosureId,
                identityHash,
                disclosedAttributes,
                recipient,
                txHash: receipt.hash
            });

            logger.info(`✅ Selective disclosure created: ${disclosureId}`);
            return {
                success: true,
                disclosureId,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Selective disclosure creation failed:', error);
            throw error;
        }
    }

    async revokeSelectiveDisclosure(disclosureId) {
        try {
            const tx = await this.zkid.revokeSelectiveDisclosure(disclosureId, {
                gasLimit: 100000
            });
            const receipt = await tx.wait();

            logger.info(`✅ Selective disclosure revoked: ${disclosureId}`);
            return {
                success: true,
                disclosureId,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Selective disclosure revocation failed:', error);
            throw error;
        }
    }

    // ============ View Functions ============

    async getIdentity(identityHash) {
        try {
            const identity = await this.zkid.getIdentity(identityHash);
            return {
                identityHash: identity[0],
                owner: identity[1],
                createdAt: identity[2].toString(),
                updatedAt: identity[3].toString(),
                isActive: identity[4],
                credentialHashes: identity[5]
            };
        } catch (error) {
            logger.error('Identity fetch failed:', error);
            return null;
        }
    }

    async getCredential(credentialHash) {
        try {
            const credential = await this.zkid.getCredential(credentialHash);
            return {
                credentialHash: credential[0],
                identityHash: credential[1],
                credentialType: credential[2],
                schemaHash: credential[3],
                issuedAt: credential[4].toString(),
                expiresAt: credential[5].toString(),
                revoked: credential[6],
                issuer: credential[7]
            };
        } catch (error) {
            logger.error('Credential fetch failed:', error);
            return null;
        }
    }

    // ============ Database Operations ============

    async storeIdentity(data) {
        const { error } = await supabase
            .from('zkid_identities')
            .insert([{
                identity_hash: data.identityHash,
                user_address: data.userAddress,
                tx_hash: data.txHash,
                created_at: new Date().toISOString()
            }]);
        if (error) throw error;
    }

    async storeCredential(data) {
        const { error } = await supabase
            .from('zkid_credentials')
            .insert([{
                identity_hash: data.identityHash,
                credential_hash: data.credentialHash,
                credential_type: data.credentialType,
                tx_hash: data.txHash,
                issued_at: new Date().toISOString()
            }]);
        if (error) throw error;
    }

    async updateCredentialStatus(credentialHash, revoked) {
        const { error } = await supabase
            .from('zkid_credentials')
            .update({ revoked, revoked_at: new Date().toISOString() })
            .eq('credential_hash', credentialHash);
        if (error) throw error;
    }

    async storeVerificationRequest(data) {
        const { error } = await supabase
            .from('zkid_verifications')
            .insert([{
                request_id: data.requestId,
                identity_hash: data.identityHash,
                credential_hash: data.credentialHash,
                tx_hash: data.txHash,
                verified: true,
                created_at: new Date().toISOString()
            }]);
        if (error) throw error;
    }

    async storeSelectiveDisclosure(data) {
        const { error } = await supabase
            .from('zkid_disclosures')
            .insert([{
                disclosure_id: data.disclosureId,
                identity_hash: data.identityHash,
                disclosed_attributes: data.disclosedAttributes,
                recipient: data.recipient,
                tx_hash: data.txHash,
                created_at: new Date().toISOString()
            }]);
        if (error) throw error;
    }

    // ============ Statistics ============

    async getZKIDStats() {
        try {
            const { data: identities } = await supabase
                .from('zkid_identities')
                .select('*');

            const { data: credentials } = await supabase
                .from('zkid_credentials')
                .select('*');

            const { data: verifications } = await supabase
                .from('zkid_verifications')
                .select('*');

            const { data: disclosures } = await supabase
                .from('zkid_disclosures')
                .select('*');

            return {
                totalIdentities: identities?.length || 0,
                activeIdentities: identities?.filter(i => i.is_active !== false).length || 0,
                totalCredentials: credentials?.length || 0,
                revokedCredentials: credentials?.filter(c => c.revoked === true).length || 0,
                totalVerifications: verifications?.length || 0,
                totalDisclosures: disclosures?.length || 0,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Stats fetch failed:', error);
            return null;
        }
    }
}

export default new ZKIDService();