import { ethers } from 'ethers';
import { randomUUID as uuidv4 } from 'node:crypto';
import crypto from 'node:crypto';
import logger from '../api/src/middleware/logger.js';
import { supabase, supabaseAdmin } from '../api/src/config/db.js';

const BASE58_ALPHABET =
    '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58btc(input) {
    const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);

    if (bytes.length === 0) {
        return '';
    }

    let zeros = 0;

    while (zeros < bytes.length && bytes[zeros] === 0) {
        zeros++;
    }

    let digits = [0];

    for (const byte of bytes) {
        let carry = byte;

        for (let i = 0; i < digits.length; i++) {
            carry += digits[i] * 256;
            digits[i] = carry % 58;
            carry = Math.floor(carry / 58);
        }

        while (carry > 0) {
            digits.push(carry % 58);
            carry = Math.floor(carry / 58);
        }
    }

    let output = '';

    for (let i = 0; i < zeros; i++) {
        output += '1';
    }

    for (let i = digits.length - 1; i >= 0; i--) {
        output += BASE58_ALPHABET[digits[i]];
    }

    return output;
}

class DIDService {
    constructor() {
        // Chain clients are initialized lazily.
        // This prevents the API from failing during startup when
        // blockchain-related environment variables are not configured.
        this._provider = null;
        this._wallet = null;
        this._didRegistry = null;
        this._identityWallet = null;

        this.didRegistryAddress = process.env.DID_REGISTRY_ADDRESS;
        this.identityWalletAddress = process.env.IDENTITY_WALLET_ADDRESS;

        this.didRegistryABI = [
            'function createDID(string memory did) external',
            'function createDIDFor(string memory did, address didOwner) external',
            'function configureDIDDuringCreation(string memory did, tuple(string id, string endpointType, string serviceEndpoint, string description)[] memory endpoints, tuple(string id, string keyType, string controller, string publicKeyMultibase)[] memory methods) external',
            'function deactivateDID(string memory did) external',
            'function addServiceEndpoint(string memory did, string memory id, string memory type, string memory serviceEndpoint, string memory description) external',
            'function addVerificationMethod(string memory did, string memory id, string memory type, string memory controller, string memory publicKeyMultibase) external',
            'function issueCredential(address subject, string memory credentialType, bytes32 schemaHash, uint256 validUntil, bytes32 proofHash) external returns (bytes32)',
            'function revokeCredential(bytes32 credentialId) external',
            'function verifyCredential(bytes32 credentialId) external view returns (bool)',
            'function getDID(string memory did) external view returns (address, string, bool, uint256, uint256)',
            'function getCredential(bytes32 credentialId) external view returns (tuple(bytes32, address, address, string, bytes32, uint256, uint256, bool, bytes32))',
            'function isDIDActive(string memory did) external view returns (bool)',
            'function didInitialized(string memory did) external view returns (bool)',
            'function issuerNonces(address issuer) external view returns (uint256)',
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

        logger.info('✅ DID Service initialized');
    }

    // ============ Chain clients ============

    get provider() {
        if (!this._provider) {
            if (!process.env.POLYGON_RPC_URL) {
                throw new Error(
                    'DID chain access is not configured: set POLYGON_RPC_URL'
                );
            }

            this._provider = new ethers.JsonRpcProvider(
                process.env.POLYGON_RPC_URL
            );
        }

        return this._provider;
    }

    set provider(value) {
        this._provider = value;
    }

    get wallet() {
        if (!this._wallet) {
            if (!process.env.PRIVATE_KEY) {
                throw new Error(
                    'DID chain access is not configured: set PRIVATE_KEY'
                );
            }

            this._wallet = new ethers.Wallet(
                process.env.PRIVATE_KEY,
                this.provider
            );
        }

        return this._wallet;
    }

    set wallet(value) {
        this._wallet = value;
    }

    get didRegistry() {
        if (!this._didRegistry) {
            if (!this.didRegistryAddress) {
                throw new Error(
                    'DID chain access is not configured: set DID_REGISTRY_ADDRESS'
                );
            }

            this._didRegistry = new ethers.Contract(
                this.didRegistryAddress,
                this.didRegistryABI,
                this.wallet
            );
        }

        return this._didRegistry;
    }

    set didRegistry(value) {
        this._didRegistry = value;
    }

    get identityWallet() {
        if (!this._identityWallet) {
            if (!this.identityWalletAddress) {
                throw new Error(
                    'DID chain access is not configured: set IDENTITY_WALLET_ADDRESS'
                );
            }

            this._identityWallet = new ethers.Contract(
                this.identityWalletAddress,
                this.identityWalletABI,
                this.wallet
            );
        }

        return this._identityWallet;
    }

    set identityWallet(value) {
        this._identityWallet = value;
    }

    // ============ Validation ============

    _validateCredentialData(data) {
        if (!data || typeof data !== 'object') {
            throw new Error('Credential data is required');
        }

        if (!data.credentialId) {
            throw new Error('credentialId is required');
        }

        if (!data.subject) {
            throw new Error('subject is required');
        }

        if (!data.credentialType) {
            throw new Error('credentialType is required');
        }

        if (!data.issuedAt) {
            data.issuedAt = new Date().toISOString();
        }

        return data;
    }

    _validateAddress(address, fieldName = 'address') {
        if (!address || !ethers.isAddress(address)) {
            throw new Error(`Invalid ${fieldName}`);
        }
    }

    // ============ DID Operations ============

    async createDID(userAddress, publicKey) {
        try {
            this._validateAddress(userAddress, 'userAddress');

            const did = `did:truxify:${uuidv4()}`;

            const tx = await this.didRegistry.createDIDFor(
                did,
                userAddress
            );

            const receipt = await tx.wait();

            if (!receipt) {
                throw new Error('DID creation transaction was not mined');
            }

            // Verify that the owner stored on-chain matches the requested owner.
            const didData = await this.didRegistry.getDID(did);

            if (
                !didData ||
                !didData[0] ||
                didData[0].toLowerCase() !== userAddress.toLowerCase()
            ) {
                throw new Error(
                    `On-chain DID owner mismatch: expected ${userAddress}, got ${didData?.[0]}`
                );
            }

            let publicKeyMultibase = publicKey;
            let privateKey = null;

            if (!publicKeyMultibase) {
                const keyPair = crypto.generateKeyPairSync('rsa', {
                    modulusLength: 2048,
                    publicKeyEncoding: {
                        type: 'spki',
                        format: 'der'
                    },
                    privateKeyEncoding: {
                        type: 'pkcs8',
                        format: 'pem'
                    }
                });

                publicKeyMultibase = `z${base58btc(keyPair.publicKey)}`;

                privateKey = Buffer.from(keyPair.privateKey).toString(
                    'base64'
                );
            }

            const apiUrl = process.env.API_URL || '';

            const initialEndpoints = [
                {
                    id: 'identity',
                    endpointType: 'IdentityService',
                    serviceEndpoint: `${apiUrl}/api/did/identity`,
                    description: 'Main identity service'
                },
                {
                    id: 'credentials',
                    endpointType: 'CredentialService',
                    serviceEndpoint: `${apiUrl}/api/did/credentials`,
                    description: 'Credential management service'
                }
            ];

            const initialMethods = [
                {
                    id: 'key-1',
                    keyType: 'RsaVerificationKey2018',
                    controller: did,
                    publicKeyMultibase
                }
            ];

            const setupTx =
                await this.didRegistry.configureDIDDuringCreation(
                    did,
                    initialEndpoints,
                    initialMethods
                );

            await setupTx.wait();

            const walletTx = await this.identityWallet.createWallet(did);
            await walletTx.wait();

            await this.storeDID({
                did,
                owner: userAddress,
                publicKey: publicKeyMultibase
            });

            logger.info(`✅ DID created: ${did}`);

            return {
                success: true,
                did,
                publicKey: publicKeyMultibase,
                privateKey,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('DID creation failed:', error);
            throw error;
        }
    }

    async addServiceEndpoint(
        did,
        id,
        type,
        endpoint,
        description
    ) {
        try {
            if (!did) {
                throw new Error('DID is required');
            }

            const tx = await this.didRegistry.addServiceEndpoint(
                did,
                id,
                type,
                endpoint,
                description
            );

            await tx.wait();

            return {
                success: true,
                txHash: tx.hash
            };
        } catch (error) {
            logger.error(
                'Service endpoint addition failed:',
                error
            );

            throw error;
        }
    }

    async addVerificationMethod(
        did,
        id,
        type,
        controller,
        publicKey
    ) {
        try {
            if (!did) {
                throw new Error('DID is required');
            }

            if (!publicKey) {
                throw new Error('publicKey is required');
            }

            const tx = await this.didRegistry.addVerificationMethod(
                did,
                id,
                type,
                controller,
                publicKey
            );

            await tx.wait();

            return {
                success: true,
                txHash: tx.hash
            };
        } catch (error) {
            logger.error(
                'Verification method addition failed:',
                error
            );

            throw error;
        }
    }

    // ============ Credential Operations ============

    async issueCredential(
        subject,
        credentialType,
        schema,
        validUntil
    ) {
        try {
            this._validateAddress(subject, 'subject');

            if (!credentialType) {
                throw new Error('credentialType is required');
            }

            const schemaHash = ethers.keccak256(
                ethers.toUtf8Bytes(JSON.stringify(schema))
            );

            const proof = this.generateProof(
                subject,
                credentialType,
                schema
            );

            const proofHash = ethers.keccak256(
                ethers.toUtf8Bytes(proof)
            );

            const validUntilTimestamp =
                validUntil ||
                Math.floor(Date.now() / 1000) +
                    365 * 24 * 60 * 60;

            const tx = await this.didRegistry.issueCredential(
                subject,
                credentialType,
                schemaHash,
                validUntilTimestamp,
                proofHash
            );

            const receipt = await tx.wait();

            if (!receipt) {
                throw new Error(
                    'Credential issuance transaction was not mined'
                );
            }

            let credentialId = null;

            // 1. Resolve the credential ID from the emitted event.
            for (const log of receipt.logs) {
                try {
                    const parsed =
                        this.didRegistry.interface.parseLog(log);

                    if (
                        parsed &&
                        parsed.name === 'CredentialIssued'
                    ) {
                        credentialId = parsed.args[0];
                        break;
                    }
                } catch {
                    // Ignore logs that do not belong to DIDRegistry.
                }
            }

            // 2. Fallback to direct event-topic extraction.
            if (!credentialId) {
                const eventTopic0 = ethers.id(
                    'CredentialIssued(bytes32,address,address)'
                );

                for (const log of receipt.logs) {
                    if (
                        log.topics &&
                        log.topics[0] === eventTopic0 &&
                        log.topics[1]
                    ) {
                        credentialId = log.topics[1];
                        break;
                    }
                }
            }

            // 3. Final fallback:
            // Reconstruct possible credential IDs from the transaction block
            // and issuer nonce, then verify the candidate against on-chain data.
            if (!credentialId) {
                const block = await this.provider.getBlock(
                    receipt.blockNumber
                );

                if (!block) {
                    throw new Error(
                        `Unable to load block ${receipt.blockNumber}`
                    );
                }

                const currentNonce =
                    await this.didRegistry.issuerNonces(
                        this.wallet.address
                    );

                const maxSearch =
                    currentNonce > 20n ? 20n : currentNonce;

                for (let i = 1n; i <= maxSearch; i++) {
                    const candidateNonce = currentNonce - i;

                    const candidateId = ethers.keccak256(
                        ethers.solidityPacked(
                            [
                                'uint256',
                                'address',
                                'address',
                                'string',
                                'uint256'
                            ],
                            [
                                block.timestamp,
                                this.wallet.address,
                                subject,
                                credentialType,
                                candidateNonce
                            ]
                        )
                    );

                    const onChainCredential =
                        await this.didRegistry.getCredential(
                            candidateId
                        );

                    if (
                        onChainCredential &&
                        onChainCredential[1] &&
                        onChainCredential[1].toLowerCase() ===
                            this.wallet.address.toLowerCase() &&
                        onChainCredential[2].toLowerCase() ===
                            subject.toLowerCase() &&
                        onChainCredential[8] === proofHash
                    ) {
                        credentialId = candidateId;
                        break;
                    }
                }
            }

            if (!credentialId) {
                throw new Error(
                    `Failed to resolve valid on-chain credentialId for subject ${subject}`
                );
            }

            const addCredentialTx =
                await this.identityWallet.addCredential(
                    credentialId
                );

            await addCredentialTx.wait();

            await this.storeCredential({
                credentialId,
                subject,
                credentialType,
                schema,
                issuedAt: new Date().toISOString(),
                validUntil: new Date(
                    validUntilTimestamp * 1000
                ).toISOString(),
                txHash: receipt.hash,
                proof
            });

            logger.info(
                `✅ Credential issued: ${credentialId}`
            );

            return {
                success: true,
                credentialId
            };
        } catch (error) {
            logger.error(
                'Credential issuance failed:',
                error
            );

            throw error;
        }
    }

    async verifyCredential(credentialId) {
        try {
            if (!credentialId) {
                throw new Error(
                    'credentialId is required'
                );
            }

            const isValid =
                await this.didRegistry.verifyCredential(
                    credentialId
                );

            const credential =
                await this.didRegistry.getCredential(
                    credentialId
                );

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
            logger.error(
                'Credential verification failed:',
                error
            );

            throw error;
        }
    }

    async revokeCredential(credentialId) {
        try {
            if (!credentialId) {
                throw new Error(
                    'credentialId is required'
                );
            }

            const tx =
                await this.didRegistry.revokeCredential(
                    credentialId
                );

            const receipt = await tx.wait();

            if (!receipt) {
                throw new Error(
                    'Credential revocation transaction was not mined'
                );
            }

            await this.updateCredentialStatus(
                credentialId,
                true
            );

            logger.info(
                `✅ Credential revoked: ${credentialId}`
            );

            return {
                success: true,
                credentialId,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error(
                'Credential revocation failed:',
                error
            );

            throw error;
        }
    }

    // ============ Proof Generation ============

    generateProof(
        subject,
        credentialType,
        schema
    ) {
        const secret =
            process.env.DID_PROOF_SECRET ||
            'default-proof-secret';

        const payload = JSON.stringify({
            subject,
            credentialType,
            schema,
            timestamp: Date.now()
        });

        return crypto
            .createHmac('sha256', secret)
            .update(payload)
            .digest('hex');
    }

    // ============ DID Queries ============

    async getDID(did) {
        try {
            if (!did) {
                throw new Error('DID is required');
            }

            const didData =
                await this.didRegistry.getDID(did);

            return {
                did,
                owner: didData[0],
                isActive: didData[2],
                createdAt: didData[3].toString(),
                updatedAt: didData[4].toString()
            };
        } catch (error) {
            logger.error(
                'DID fetch failed:',
                error
            );

            return null;
        }
    }

    async getWallet(address) {
        try {
            this._validateAddress(address);

            const walletData =
                await this.identityWallet.getWallet(
                    address
                );

            return {
                owner: walletData[0],
                did: walletData[1],
                credentials: walletData[2],
                isActive: walletData[3]
            };
        } catch (error) {
            logger.error(
                'Wallet fetch failed:',
                error
            );

            return null;
        }
    }

    async getCredentials(address) {
        try {
            this._validateAddress(address);

            const credentials =
                await this.identityWallet.getCredentials(
                    address
                );

            const credentialDetails = [];

            for (const credentialId of credentials) {
                const details =
                    await this.didRegistry.getCredential(
                        credentialId
                    );

                credentialDetails.push({
                    id: details[0],
                    issuer: details[1],
                    subject: details[2],
                    type: details[3],
                    issuedAt: details[5].toString(),
                    validUntil: details[6].toString(),
                    revoked: details[7]
                });
            }

            return credentialDetails;
        } catch (error) {
            logger.error(
                'Credentials fetch failed:',
                error
            );

            return [];
        }
    }

    // ============ Supabase Operations ============

    async storeDID(data) {
        if (!data?.did) {
            throw new Error('DID is required');
        }

        if (!data?.owner) {
            throw new Error('DID owner is required');
        }

        const client = supabaseAdmin || supabase;

        if (!client) {
            throw new Error(
                'Supabase client is not configured'
            );
        }

        const { error } = await client
            .from('dids')
            .insert([
                {
                    did: data.did,
                    owner: data.owner,
                    public_key: data.publicKey || null,
                    created_at: new Date().toISOString()
                }
            ]);

        if (error) {
            throw error;
        }
    }

    async storeCredential(data) {
        try {
            const validatedData =
                this._validateCredentialData(data);

            const client =
                supabaseAdmin || supabase;

            if (!client) {
                throw new Error(
                    'Supabase client is not configured'
                );
            }

            const { error } = await client
                .from('credentials')
                .insert([
                    {
                        credential_id:
                            validatedData.credentialId,
                        subject:
                            validatedData.subject,
                        credential_type:
                            validatedData.credentialType,
                        schema:
                            validatedData.schema || null,
                        issued_at:
                            validatedData.issuedAt,
                        valid_until:
                            validatedData.validUntil ||
                            null,
                        tx_hash:
                            validatedData.txHash ||
                            null,
                        proof:
                            validatedData.proof ||
                            null,
                        revoked: false,
                        revoked_at: null
                    }
                ]);

            if (error) {
                throw error;
            }

            return {
                success: true,
                credentialId:
                    validatedData.credentialId
            };
        } catch (error) {
            logger.error(
                { err: error },
                'Failed to store credential'
            );

            throw error;
        }
    }

    async updateCredentialStatus(
        credentialId,
        revoked
    ) {
        if (!credentialId) {
            throw new Error(
                'credentialId is required'
            );
        }

        const client =
            supabaseAdmin || supabase;

        if (!client) {
            throw new Error(
                'Supabase client is not configured'
            );
        }

        const { error } = await client
            .from('credentials')
            .update({
                revoked: Boolean(revoked),
                revoked_at: revoked
                    ? new Date().toISOString()
                    : null
            })
            .eq(
                'credential_id',
                credentialId
            );

        if (error) {
            throw error;
        }
    }

    async getDIDStats() {
        const client =
            supabaseAdmin || supabase;

        if (!client) {
            throw new Error(
                'Supabase client is not configured'
            );
        }

        const [
            { data: dids, error: didsError },
            { data: credentials, error: credentialsError }
        ] = await Promise.all([
            client
                .from('dids')
                .select('*')
                .order('created_at', {
                    ascending: false
                })
                .limit(100),

            client
                .from('credentials')
                .select('*')
                .order('issued_at', {
                    ascending: false
                })
                .limit(100)
        ]);

        if (didsError || credentialsError) {
            logger.error(
                'Failed to fetch DID stats',
                {
                    didsError,
                    credentialsError
                }
            );
        }

        const safeDids = dids || [];
        const safeCredentials =
            credentials || [];

        return {
            totalDIDs: safeDids.length,

            activeDIDs: safeDids.filter(
                (did) =>
                    did.is_active !== false
            ).length,

            totalCredentials:
                safeCredentials.length,

            revokedCredentials:
                safeCredentials.filter(
                    (credential) =>
                        credential.revoked === true
                ).length
        };
    }
}

export default new DIDService();
