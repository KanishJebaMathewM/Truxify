import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import logger from '../api/src/middleware/logger.js';
import { supabase } from '../api/src/config/db.js';
import { zkDidVerifier } from './did_verifier.js';

class ZKIDService {
    constructor() {
        this.provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
        this._wallet = null;
        this.zkidAddress = process.env.ZKID_CONTRACT_ADDRESS;

        // ABI mirrors the deployed ZKIdentity.sol surface only. The contract
        // exposes registerDID / revokeCredential / verifyZkProof plus the
        // public state getters; any selector not in this list reverts on-chain.
        this.zkidABI = [
            'function registerDID(string didURI, bytes32 merkleRoot) external',
            'function revokeCredential(bytes32 credentialHash) external',
            'function verifyZkProof(address identity, bytes32 proofHash, bytes32 nullifierHash) external view returns (bool)',
            'function didRegistry(address identity) external view returns (string didURI, bytes32 credentialMerkleRoot, bool isRevoked, uint256 registeredAt)',
            'function revokedCredentials(bytes32 credentialHash) external view returns (bool)'
        ];

        // Generate identity secret
        this.identitySecret = crypto.randomBytes(32);

        logger.info('✅ ZK-ID Service initialized');
    }

    // The wallet and contract are created lazily so importing this module
    // never crashes when PRIVATE_KEY is unset. Callers that actually sign or
    // read on-chain state get a clear validation error instead.
    getWallet() {
        if (this._wallet) return this._wallet;

        const privateKey = process.env.PRIVATE_KEY;
        if (!privateKey || !privateKey.trim()) {
            throw new Error('PRIVATE_KEY environment variable is required to use the ZK-ID service');
        }

        this._wallet = new ethers.Wallet(privateKey.trim(), this.provider);
        return this._wallet;
    }

    getZkidContract() {
        if (this._zkid) return this._zkid;

        this._zkid = new ethers.Contract(this.zkidAddress, this.zkidABI, this.getWallet());
        return this._zkid;
    }

    // ============ Identity Management ============

    async createIdentity(userAddress) {
        try {
            // Generate identity hash
            const identityHash = ethers.keccak256(
                ethers.toUtf8Bytes(`${userAddress}:${Date.now()}:${uuidv4()}`)
            );

            // The contract keys DID documents by the caller address and stores
            // the identity hash as the credential merkle root.
            const didURI = zkDidVerifier.createDidUri(userAddress);

            const tx = await this.getZkidContract().registerDID(didURI, identityHash, {
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

            // The ZKIdentity contract exposes no credential issuance API — it
            // only registers DIDs, revokes credentials and verifies zk proofs.
            // Issuance is an off-chain (DB-anchored) operation; verification
            // and revocation are what the contract guarantees.
            await this.storeCredential({
                identityHash,
                credentialHash,
                credentialType,
                txHash: null
            });

            logger.info(`✅ Credential issued: ${credentialHash}`);
            return {
                success: true,
                credentialHash,
                txHash: null
            };
        } catch (error) {
            logger.error('Credential issuance failed:', error);
            throw error;
        }
    }

    async revokeCredential(credentialHash) {
        try {
            const tx = await this.getZkidContract().revokeCredential(credentialHash, {
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
            // On-chain revocation check against the real contract getter, plus
            // the issued credential record persisted by issueCredential.
            const isRevoked = await this.getZkidContract().revokedCredentials(credentialHash);

            const { data: credentialRow } = await supabase
                .from('zkid_credentials')
                .select('*')
                .eq('credential_hash', credentialHash)
                .maybeSingle();

            return {
                success: true,
                isValid: !isRevoked && Boolean(credentialRow),
                credential: credentialRow
                    ? {
                        credentialHash: credentialRow.credential_hash,
                        identityHash: credentialRow.identity_hash,
                        credentialType: credentialRow.credential_type,
                        schemaHash: ethers.ZeroHash,
                        issuedAt: credentialRow.issued_at,
                        expiresAt: null,
                        revoked: Boolean(credentialRow.revoked),
                        issuer: this.getWallet().address
                    }
                    : null,
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
            // Resolve the identity's owning address so the on-chain proof check
            // runs against the address-keyed DID registry (didRegistry).
            const { data: identity } = await supabase
                .from('zkid_identities')
                .select('user_address')
                .eq('identity_hash', identityHash)
                .maybeSingle();

            const proofPayload = typeof proofData === 'string'
                ? proofData
                : JSON.stringify(proofData || '');
            const proofHash = proofData?.proofHash
                || ethers.keccak256(ethers.toUtf8Bytes(proofPayload));
            const nullifierHash = proofData?.nullifierHash
                || ethers.keccak256(ethers.toUtf8Bytes(credentialHash));

            let verified = false;
            if (identity?.user_address) {
                verified = await this.getZkidContract().verifyZkProof(
                    identity.user_address,
                    proofHash,
                    nullifierHash
                );
            }

            const requestId = ethers.keccak256(
                ethers.toUtf8Bytes(`${identityHash}:${credentialHash}:${Date.now()}:${uuidv4()}`)
            );

            await this.storeVerificationRequest({
                requestId,
                identityHash,
                credentialHash,
                txHash: null,
                verified
            });

            logger.info(`✅ Verification requested: ${requestId}`);
            return {
                success: true,
                requestId,
                txHash: null
            };
        } catch (error) {
            logger.error('Verification request failed:', error);
            throw error;
        }
    }

    // ============ Selective Disclosure ============

    async createSelectiveDisclosure(identityHash, disclosedAttributes, recipient) {
        try {
            const disclosureId = ethers.keccak256(
                ethers.toUtf8Bytes(`${identityHash}:${Date.now()}:${recipient}`)
            );

            // The contract has no disclosure API; disclosures are off-chain
            // records bound to the identity stored in the DID registry.
            await this.storeSelectiveDisclosure({
                disclosureId,
                identityHash,
                disclosedAttributes,
                recipient,
                txHash: null
            });

            logger.info(`✅ Selective disclosure created: ${disclosureId}`);
            return {
                success: true,
                disclosureId,
                txHash: null
            };
        } catch (error) {
            logger.error('Selective disclosure creation failed:', error);
            throw error;
        }
    }

    async revokeSelectiveDisclosure(disclosureId) {
        try {
            const { error } = await supabase
                .from('zkid_disclosures')
                .update({ revoked: true, revoked_at: new Date().toISOString() })
                .eq('disclosure_id', disclosureId);
            if (error) throw error;

            logger.info(`✅ Selective disclosure revoked: ${disclosureId}`);
            return {
                success: true,
                disclosureId,
                txHash: null
            };
        } catch (error) {
            logger.error('Selective disclosure revocation failed:', error);
            throw error;
        }
    }

    // ============ View Functions ============

    async getIdentity(identityHash) {
        try {
            const { data: identityRow } = await supabase
                .from('zkid_identities')
                .select('*')
                .eq('identity_hash', identityHash)
                .maybeSingle();

            // Fetch the on-chain DID document via the real public getter when
            // the owning address is known.
            let didDocument = null;
            if (identityRow?.user_address) {
                const doc = await this.getZkidContract().didRegistry(identityRow.user_address);
                didDocument = {
                    didURI: doc[0],
                    credentialMerkleRoot: doc[1],
                    isRevoked: doc[2],
                    registeredAt: doc[3].toString()
                };
            }

            return {
                identityHash,
                userAddress: identityRow?.user_address || null,
                isActive: identityRow?.is_active !== false,
                didDocument,
                createdAt: identityRow?.created_at || null
            };
        } catch (error) {
            logger.error('Identity fetch failed:', error);
            return null;
        }
    }

    async getCredential(credentialHash) {
        try {
            const { data: credentialRow } = await supabase
                .from('zkid_credentials')
                .select('*')
                .eq('credential_hash', credentialHash)
                .maybeSingle();

            if (!credentialRow) return null;

            return {
                credentialHash: credentialRow.credential_hash,
                identityHash: credentialRow.identity_hash,
                credentialType: credentialRow.credential_type,
                schemaHash: ethers.ZeroHash,
                issuedAt: credentialRow.issued_at,
                expiresAt: null,
                revoked: Boolean(credentialRow.revoked),
                issuer: this.getWallet().address
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
                verified: data.verified ?? true,
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