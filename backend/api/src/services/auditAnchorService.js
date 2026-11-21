const crypto = require('crypto');
const { ethers } = require('ethers');

const REGISTRY_ABI = [
    'function anchorState(string ewbNumber, bytes32 payloadHash, uint256 validUpto, string eventType) external',
    'function getLatestRecord(string ewbNumber) external view returns (bytes32 payloadHash, uint256 validUpto, uint256 anchoredAt, string eventType)',
];

class AuditAnchorService {
    constructor() {
        this.rpcUrl = process.env.POLYGON_RPC_URL || 'https://rpc-amoy.polygon.technology';
        this.privateKey = process.env.POLYGON_SIGNER_PRIVATE_KEY || '';
        this.contractAddress = process.env.EWAY_AUDIT_CONTRACT_ADDRESS || '';

        if (this.privateKey && this.contractAddress) {
            this.provider = new ethers.JsonRpcProvider(this.rpcUrl);
            this.wallet = new ethers.Wallet(this.privateKey, this.provider);
            this.contract = new ethers.Contract(
                this.contractAddress,
                REGISTRY_ABI,
                this.wallet
            );
        }
    }

    /**
     * Generates a deterministic SHA-256 hash of critical consignment metadata.
     */
    computeConsignmentHash(metadata) {
        const canonicalPayload = JSON.stringify({
            ewbNumber: String(metadata.ewbNumber).trim(),
            consignorGstin: String(metadata.consignorGstin).trim().toUpperCase(),
            consigneeGstin: String(metadata.consigneeGstin).trim().toUpperCase(),
            invoiceValue: Number(metadata.invoiceValue).toFixed(2),
            vehicleNumber: String(metadata.vehicleNumber).replace(/\s+/g, '').toUpperCase(),
            originPincode: String(metadata.originPincode).trim(),
            destinationPincode: String(metadata.destinationPincode).trim(),
            validUpto: new Date(metadata.validUpto).toISOString(),
        });

        return crypto.createHash('sha256').update(canonicalPayload).digest('hex');
    }

    /**
     * Anchors the SHA-256 hash onto Polygon for immutable QR verification.
     */
    async anchorConsignmentState(metadata, eventType = 'CREATED') {
        const sha256Hex = this.computeConsignmentHash(metadata);
        const bytes32Hash = `0x${sha256Hex}`;
        const validUptoUnix = Math.floor(new Date(metadata.validUpto).getTime() / 1000);

        if (!this.contract) {
            return {
                sha256Hex,
                txHash: null,
                anchoredOnChain: false,
                reason: 'Polygon signer credentials not configured',
            };
        }

        const tx = await this.contract.anchorState(
            String(metadata.ewbNumber),
            bytes32Hash,
            validUptoUnix,
            eventType
        );
        const receipt = await tx.wait(1);

        return {
            sha256Hex,
            txHash: receipt.hash,
            anchoredOnChain: true,
        };
    }

    /**
     * Verifies a database record against the on-chain Polygon record for RTO/inspector QR scan.
     */
    async verifyOnChain(metadata) {
        const localHash = this.computeConsignmentHash(metadata);

        if (!this.contract) {
            return {
                verified: false,
                localHash,
                onChainHash: null,
                reason: 'Polygon RPC not configured',
            };
        }

        const [onChainBytes32, validUptoUnix, anchoredAtUnix, eventType] =
            await this.contract.getLatestRecord(String(metadata.ewbNumber));

        const onChainHash = onChainBytes32.replace(/^0x/, '');

        return {
            verified: localHash === onChainHash,
            localHash,
            onChainHash,
            onChainValidUpto: new Date(Number(validUptoUnix) * 1000).toISOString(),
            anchoredAt: new Date(Number(anchoredAtUnix) * 1000).toISOString(),
            eventType,
        };
    }
}

module.exports = new AuditAnchorService();