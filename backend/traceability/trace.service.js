import { ethers } from 'ethers';
import crypto from 'crypto';
import logger from '../api/src/middleware/logger.js';
import { supabase } from '../api/src/config/db.js';

export const DEFAULT_COLD_CHAIN_BOUNDS = Object.freeze({
    minTempC: 2.0,
    maxTempC: 8.0,
});

class TraceabilityService {
    constructor(options = {}) {
        this.contractAddress = options.contractAddress || process.env.SUPPLY_CHAIN_ADDRESS;

        this.contractABI = [
            'function createProduct(string memory name, string memory description, string memory category, string memory metadataURI, bytes32 productHash) external returns (uint256)',
            'function createShipment(uint256 productId, address receiver, string memory location) external returns (uint256)',
            'function updateShipmentStatus(uint256 shipmentId, string memory status, string memory location) external',
            'function addCustomEvent(uint256 productId, string memory eventType, string memory location, string memory description) external',
            'function verifyProduct(uint256 productId, bool isValid, string memory notes) external',
            'function getProduct(uint256 productId) external view returns (tuple(uint256,string,string,string,address,uint256,uint256,bool,string,bytes32))',
            'function getShipment(uint256 shipmentId) external view returns (tuple(uint256,uint256,address,address,uint256,uint256,string,string,bytes32,bool))',
            'function getProductEvents(uint256 productId) external view returns (tuple(uint256,uint256,uint256,string,string,string,address,uint256,bytes32)[])',
            'function getProductTrace(uint256 productId) external view returns (tuple(uint256,string,string,string,address,uint256,uint256,bool,string,bytes32), tuple(uint256,uint256,uint256,string,string,string,address,uint256,bytes32)[], tuple(uint256,uint256,address,uint256,bool,string,bytes32)[])',
            'event ProductCreated(uint256 indexed productId, string name, address indexed manufacturer)',
            'event ShipmentCreated(uint256 indexed shipmentId, uint256 productId, address indexed sender)'
        ];

        try {
            if (options.wallet) {
                this.wallet = options.wallet;
                this.provider = this.wallet.provider;
            } else if (process.env.PRIVATE_KEY && process.env.POLYGON_RPC_URL) {
                this.provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
                this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
            } else {
                this.wallet = ethers.Wallet.createRandom();
                this.provider = null;
            }

            if (this.contractAddress && this.wallet) {
                this.contract = new ethers.Contract(this.contractAddress, this.contractABI, this.wallet);
            } else {
                this.contract = null;
            }
        } catch (err) {
            this.wallet = null;
            this.contract = null;
        }

        logger.info('✅ Traceability Service initialized');
    }

    // ============ Hash Chaining & Tamper Verification ============

    /**
     * Computes deterministic cryptographic Keccak-256 hash for an event linked to its predecessor.
     */
    computeEventHash({ productId, eventType, location, description, prevHash, timestamp }) {
        if (!productId || !eventType || !prevHash) {
            throw new Error('productId, eventType, and prevHash are required to compute chained event hash');
        }

        const canonicalPayload = JSON.stringify({
            productId: String(productId),
            eventType: String(eventType).trim(),
            location: String(location || '').trim(),
            description: String(description || '').trim(),
            prevHash: String(prevHash),
            timestamp: String(timestamp || '')
        });

        return ethers.keccak256(ethers.toUtf8Bytes(canonicalPayload));
    }

    /**
     * Verifies cryptographic integrity of an entire event sequence against the product's genesis hash.
     * Detects tampering, reordering, and dropped events in the audit log.
     */
    verifyEventChain(events, genesisProductHash) {
        if (!Array.isArray(events) || events.length === 0) {
            return {
                isValid: true,
                chainLength: 0,
                message: 'Empty event chain is vacuously valid'
            };
        }

        if (!genesisProductHash) {
            return {
                isValid: false,
                brokenIndex: 0,
                reason: 'Genesis product hash is required to verify root of trust'
            };
        }

        let expectedPrevHash = genesisProductHash;

        for (let i = 0; i < events.length; i++) {
            const event = events[i];

            // 1. Verify predecessor linkage
            if (event.prevHash !== expectedPrevHash) {
                return {
                    isValid: false,
                    brokenIndex: i,
                    reason: `Chain broken at event ${i}: expected prevHash ${expectedPrevHash}, received ${event.prevHash}`
                };
            }

            // 2. Recalculate and verify hash integrity
            const recalculatedHash = this.computeEventHash(event);
            if (recalculatedHash !== event.eventHash) {
                return {
                    isValid: false,
                    brokenIndex: i,
                    reason: `Tamper detected at event ${i}: hash mismatch (expected ${event.eventHash}, calculated ${recalculatedHash})`
                };
            }

            // Advance pointer
            expectedPrevHash = event.eventHash;
        }

        return {
            isValid: true,
            chainLength: events.length,
            headHash: expectedPrevHash,
            message: 'Cryptographic audit chain fully verified'
        };
    }

    /**
     * Records a sensor telemetry checkpoint cryptographically chained to supply chain state.
     */
    recordSensorTelemetryCheckpoint(productId, checkpoint, prevHash) {
        if (!productId || !checkpoint || !prevHash) {
            throw new Error('productId, checkpoint, and prevHash are required');
        }

        const { temperatureC, humidityPercent, vibrationG, timestamp, location } = checkpoint;

        if (temperatureC !== undefined && (typeof temperatureC !== 'number' || !Number.isFinite(temperatureC) || temperatureC < -60 || temperatureC > 100)) {
            throw new Error('Invalid temperatureC: Must be finite number between -60 and 100');
        }

        if (humidityPercent !== undefined && (typeof humidityPercent !== 'number' || !Number.isFinite(humidityPercent) || humidityPercent < 0 || humidityPercent > 100)) {
            throw new Error('Invalid humidityPercent: Must be finite number between 0 and 100');
        }

        if (vibrationG !== undefined && (typeof vibrationG !== 'number' || !Number.isFinite(vibrationG) || vibrationG < 0 || vibrationG > 50)) {
            throw new Error('Invalid vibrationG: Must be finite number between 0 and 50');
        }

        const recordedAt = timestamp || new Date().toISOString();
        const checkpointData = {
            productId: String(productId),
            temperatureC,
            humidityPercent,
            vibrationG,
            location: location || '',
            prevHash,
            timestamp: recordedAt
        };

        const checkpointHash = ethers.keccak256(
            ethers.toUtf8Bytes(JSON.stringify(checkpointData))
        );

        return {
            ...checkpointData,
            checkpointHash
        };
    }

    /**
     * Detects cold chain excursions (breaches) across sequential sensor telemetry checkpoints.
     */
    detectColdChainBreach(checkpoints, bounds = DEFAULT_COLD_CHAIN_BOUNDS) {
        if (!Array.isArray(checkpoints) || checkpoints.length === 0) {
            return {
                hasBreach: false,
                totalExcursions: 0,
                maxDeviationC: 0,
                breachCheckpoints: []
            };
        }

        const { minTempC, maxTempC } = bounds;
        const breachCheckpoints = [];
        let maxDeviationC = 0;

        for (const cp of checkpoints) {
            if (cp.temperatureC !== undefined && cp.temperatureC !== null) {
                let deviation = 0;
                let isBreach = false;

                if (cp.temperatureC < minTempC) {
                    deviation = Number((minTempC - cp.temperatureC).toFixed(2));
                    isBreach = true;
                } else if (cp.temperatureC > maxTempC) {
                    deviation = Number((cp.temperatureC - maxTempC).toFixed(2));
                    isBreach = true;
                }

                if (isBreach) {
                    maxDeviationC = Math.max(maxDeviationC, deviation);
                    breachCheckpoints.push({
                        timestamp: cp.timestamp,
                        temperatureC: cp.temperatureC,
                        deviationC: deviation,
                        location: cp.location,
                        type: cp.temperatureC < minTempC ? 'UNDER_TEMP' : 'OVER_TEMP'
                    });
                }
            }
        }

        return {
            hasBreach: breachCheckpoints.length > 0,
            totalExcursions: breachCheckpoints.length,
            maxDeviationC: Number(maxDeviationC.toFixed(2)),
            breachCheckpoints
        };
    }

    // ============ Product Management ============

    async createProduct(productData) {
        try {
            const productHash = ethers.keccak256(
                ethers.toUtf8Bytes(JSON.stringify(productData))
            );

            let receiptHash = '0x' + crypto.randomBytes(32).toString('hex');
            let productId = `PROD-${crypto.randomBytes(8).toString('hex')}`;

            if (this.contract && typeof this.contract.createProduct === 'function') {
                try {
                    const tx = await this.contract.createProduct(
                        productData.name,
                        productData.description || '',
                        productData.category || 'general',
                        productData.metadataURI || '',
                        productHash,
                        { gasLimit: 300000 }
                    );
                    const receipt = await tx.wait();
                    productId = this._parseProductCreated(receipt);
                    receiptHash = receipt.hash;
                } catch (txErr) {
                    logger.warn?.('Blockchain RPC submission bypassed or unavailable:', txErr.message);
                }
            }

            await this.storeProduct({
                ...productData,
                productId,
                productHash,
                txHash: receiptHash
            });

            logger.info(`✅ Product created: ${productId}`);
            return {
                success: true,
                productId,
                productHash,
                txHash: receiptHash
            };
        } catch (error) {
            logger.error('Product creation failed:', error);
            throw error;
        }
    }

    _parseShipmentCreated(receipt) {
        if (!this.contract) throw new Error('Contract not initialized');
        for (const log of receipt.logs) {
            try {
                const parsed = this.contract.interface.parseLog(log);
                if (parsed && parsed.name === 'ShipmentCreated') {
                    return parsed.args[0].toString();
                }
            } catch (e) {
                continue;
            }
        }
        throw new Error('ShipmentCreated event not found in receipt');
    }

    _parseProductCreated(receipt) {
        if (!this.contract) throw new Error('Contract not initialized');
        for (const log of receipt.logs) {
            try {
                const parsed = this.contract.interface.parseLog(log);
                if (parsed && parsed.name === 'ProductCreated') {
                    return parsed.args[0].toString();
                }
            } catch (e) {
                continue;
            }
        }
        throw new Error('ProductCreated event not found in receipt');
    }

    // ============ Shipment Management ============

    async createShipment(productId, receiver, location) {
        try {
            let shipmentId = `SHP-${crypto.randomBytes(8).toString('hex')}`;
            let receiptHash = '0x' + crypto.randomBytes(32).toString('hex');

            if (this.contract) {
                const tx = await this.contract.createShipment(
                    productId,
                    receiver,
                    location,
                    { gasLimit: 200000 }
                );
                const receipt = await tx.wait();
                shipmentId = this._parseShipmentCreated(receipt);
                receiptHash = receipt.hash;
            }

            await this.storeShipment({
                productId,
                shipmentId: shipmentId.toString(),
                receiver,
                location,
                txHash: receiptHash
            });

            logger.info(`✅ Shipment created: ${shipmentId}`);
            return {
                success: true,
                shipmentId: shipmentId.toString(),
                txHash: receiptHash
            };
        } catch (error) {
            logger.error('Shipment creation failed:', error);
            throw error;
        }
    }

    async updateShipmentStatus(shipmentId, status, location) {
        try {
            let receiptHash = '0x' + crypto.randomBytes(32).toString('hex');

            if (this.contract) {
                const tx = await this.contract.updateShipmentStatus(
                    shipmentId,
                    status,
                    location,
                    { gasLimit: 150000 }
                );
                const receipt = await tx.wait();
                receiptHash = receipt.hash;
            }

            await this.updateShipmentInDB(shipmentId, status, location, receiptHash);

            logger.info(`✅ Shipment status updated: ${shipmentId} -> ${status}`);
            return {
                success: true,
                shipmentId,
                status,
                txHash: receiptHash
            };
        } catch (error) {
            logger.error('Shipment update failed:', error);
            throw error;
        }
    }

    // ============ Trace Events ============

    async addCustomEvent(productId, eventType, location, description, prevHash = null) {
        try {
            let receiptHash = '0x' + crypto.randomBytes(32).toString('hex');
            const timestamp = new Date().toISOString();

            let eventHash = null;
            if (prevHash) {
                eventHash = this.computeEventHash({
                    productId,
                    eventType,
                    location,
                    description,
                    prevHash,
                    timestamp
                });
            }

            if (this.contract) {
                const tx = await this.contract.addCustomEvent(
                    productId,
                    eventType,
                    location,
                    description,
                    { gasLimit: 150000 }
                );
                const receipt = await tx.wait();
                receiptHash = receipt.hash;
            }

            await this.storeEvent({
                productId,
                eventType,
                location,
                description,
                prevHash,
                eventHash,
                txHash: receiptHash,
                timestamp
            });

            logger.info(`✅ Custom event added: ${eventType}`);
            return {
                success: true,
                eventType,
                eventHash,
                prevHash,
                txHash: receiptHash
            };
        } catch (error) {
            logger.error('Custom event failed:', error);
            throw error;
        }
    }

    // ============ Verification ============

    async verifyProduct(productId, isValid, notes) {
        try {
            let receiptHash = '0x' + crypto.randomBytes(32).toString('hex');

            if (this.contract) {
                const tx = await this.contract.verifyProduct(
                    productId,
                    isValid,
                    notes || '',
                    { gasLimit: 150000 }
                );
                const receipt = await tx.wait();
                receiptHash = receipt.hash;
            }

            await this.storeVerification({
                productId,
                isValid,
                notes,
                txHash: receiptHash
            });

            logger.info(`✅ Product verified: ${productId}`);
            return {
                success: true,
                productId,
                isValid,
                txHash: receiptHash
            };
        } catch (error) {
            logger.error('Product verification failed:', error);
            throw error;
        }
    }

    // ============ View Functions ============

    async getProduct(productId) {
        try {
            if (this.contract) {
                const product = await this.contract.getProduct(productId);
                return {
                    id: product[0].toString(),
                    name: product[1],
                    description: product[2],
                    category: product[3],
                    manufacturer: product[4],
                    manufacturedAt: product[5].toString(),
                    createdAt: product[6].toString(),
                    isActive: product[7],
                    metadataURI: product[8],
                    productHash: product[9]
                };
            }
            return null;
        } catch (error) {
            logger.error('Product fetch failed:', error);
            return null;
        }
    }

    async getShipment(shipmentId) {
        try {
            if (this.contract) {
                const shipment = await this.contract.getShipment(shipmentId);
                return {
                    id: shipment[0].toString(),
                    productId: shipment[1].toString(),
                    sender: shipment[2],
                    receiver: shipment[3],
                    sentAt: shipment[4].toString(),
                    receivedAt: shipment[5].toString(),
                    status: shipment[6],
                    location: shipment[7],
                    shipmentHash: shipment[8],
                    isActive: shipment[9]
                };
            }
            return null;
        } catch (error) {
            logger.error('Shipment fetch failed:', error);
            return null;
        }
    }

    async getProductTrace(productId) {
        try {
            if (this.contract) {
                const trace = await this.contract.getProductTrace(productId);
                return {
                    product: {
                        id: trace[0][0].toString(),
                        name: trace[0][1],
                        description: trace[0][2],
                        category: trace[0][3],
                        manufacturer: trace[0][4]
                    },
                    events: trace[1].map(e => ({
                        eventType: e[3],
                        location: e[4],
                        description: e[5],
                        actor: e[6],
                        timestamp: e[7].toString()
                    })),
                    verifications: trace[2].map(v => ({
                        verifier: v[2],
                        verifiedAt: v[3].toString(),
                        isValid: v[4],
                        notes: v[5]
                    }))
                };
            }
            return null;
        } catch (error) {
            logger.error('Product trace fetch failed:', error);
            return null;
        }
    }

    // ============ Database Operations ============

    async storeProduct(data) {
        try {
            if (supabase && typeof supabase.from === 'function') {
                const { error } = await supabase
                    .from('trace_products')
                    .insert([{
                        product_id: data.productId,
                        name: data.name,
                        description: data.description,
                        category: data.category,
                        metadata_uri: data.metadataURI,
                        tx_hash: data.txHash,
                        created_at: new Date().toISOString()
                    }]);
                if (error) throw error;
            }
        } catch (err) {
            logger.warn?.('[storeProduct] DB skipped or unavailable:', err.message);
        }
    }

    async storeShipment(data) {
        try {
            if (supabase && typeof supabase.from === 'function') {
                const { error } = await supabase
                    .from('trace_shipments')
                    .insert([{
                        shipment_id: data.shipmentId,
                        product_id: data.productId,
                        receiver: data.receiver,
                        location: data.location,
                        status: 'CREATED',
                        tx_hash: data.txHash,
                        created_at: new Date().toISOString()
                    }]);
                if (error) throw error;
            }
        } catch (err) {
            logger.warn?.('[storeShipment] DB skipped or unavailable:', err.message);
        }
    }

    async updateShipmentInDB(shipmentId, status, location, txHash) {
        try {
            if (supabase && typeof supabase.from === 'function') {
                const { error } = await supabase
                    .from('trace_shipments')
                    .update({
                        status,
                        location,
                        updated_tx_hash: txHash,
                        updated_at: new Date().toISOString()
                    })
                    .eq('shipment_id', shipmentId);
                if (error) throw error;
            }
        } catch (err) {
            logger.warn?.('[updateShipmentInDB] DB skipped or unavailable:', err.message);
        }
    }

    async storeEvent(data) {
        try {
            if (supabase && typeof supabase.from === 'function') {
                const { error } = await supabase
                    .from('trace_events')
                    .insert([{
                        product_id: data.productId,
                        event_type: data.eventType,
                        location: data.location,
                        description: data.description,
                        prev_hash: data.prevHash || null,
                        event_hash: data.eventHash || null,
                        tx_hash: data.txHash,
                        created_at: data.timestamp || new Date().toISOString()
                    }]);
                if (error) throw error;
            }
        } catch (err) {
            logger.warn?.('[storeEvent] DB skipped or unavailable:', err.message);
        }
    }

    async storeVerification(data) {
        try {
            if (supabase && typeof supabase.from === 'function') {
                const { error } = await supabase
                    .from('trace_verifications')
                    .insert([{
                        product_id: data.productId,
                        is_valid: data.isValid,
                        notes: data.notes,
                        tx_hash: data.txHash,
                        created_at: new Date().toISOString()
                    }]);
                if (error) throw error;
            }
        } catch (err) {
            logger.warn?.('[storeVerification] DB skipped or unavailable:', err.message);
        }
    }

    /**
     * Verify if a user owns or has access to a shipment (CWE-639 IDOR prevention)
     */
    async verifyShipmentOwnership(shipmentId, userId) {
        try {
            if (this.contract) {
                const shipment = await this.contract.getShipment(shipmentId);
                const sender = shipment[2]?.toLowerCase();
                const receiver = shipment[3]?.toLowerCase();
                const userIdLower = userId?.toLowerCase();

                if (sender === userIdLower || receiver === userIdLower) {
                    return true;
                }
            }

            if (supabase && typeof supabase.from === 'function') {
                const { data: dbShipment } = await supabase
                    .from('trace_shipments')
                    .select('user_id, allowed_users')
                    .eq('shipment_id', shipmentId)
                    .single();

                if (dbShipment) {
                    if (dbShipment.user_id === userId) return true;
                    const allowedUsers = dbShipment.allowed_users || [];
                    if (allowedUsers.includes(userId)) return true;
                }
            }

            return false;
        } catch (error) {
            logger.error?.(`[SECURITY] Ownership verification failed for shipment ${shipmentId}:`, error);
            return false;
        }
    }

    // ============ Statistics ============

    async getTraceabilityStats() {
        try {
            let products = [];
            let shipments = [];
            let events = [];
            let verifications = [];

            if (supabase && typeof supabase.from === 'function') {
                const pRes = await supabase.from('trace_products').select('*');
                products = pRes.data || [];
                const sRes = await supabase.from('trace_shipments').select('*');
                shipments = sRes.data || [];
                const eRes = await supabase.from('trace_events').select('*');
                events = eRes.data || [];
                const vRes = await supabase.from('trace_verifications').select('*');
                verifications = vRes.data || [];
            }

            return {
                totalProducts: products?.length || 0,
                totalShipments: shipments?.length || 0,
                totalEvents: events?.length || 0,
                totalVerifications: verifications?.length || 0,
                deliveredShipments: shipments?.filter(s => s.status === 'DELIVERED').length || 0,
                verifiedProducts: verifications?.filter(v => v.is_valid === true).length || 0,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error?.('Stats fetch failed:', error);
            return null;
        }
    }
}

export { TraceabilityService };
export default new TraceabilityService();