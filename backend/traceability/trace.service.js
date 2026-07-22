import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import logger from '../../api/src/middleware/logger.js';
import { supabase } from '../../api/src/config/db.js';

class TraceabilityService {
    constructor() {
        this.provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
        this.contractAddress = process.env.SUPPLY_CHAIN_ADDRESS;

        this.contractABI = [
            'function createProduct(string memory name, string memory description, string memory category, string memory metadataURI, bytes32 productHash) external returns (uint256)',
            'function createShipment(uint256 productId, address receiver, string memory location) external returns (uint256)',
            'function updateShipmentStatus(uint256 shipmentId, string memory status, string memory location) external',
            'function addCustomEvent(uint256 productId, string memory eventType, string memory location, string memory description) external',
            'function verifyProduct(uint256 productId, bool isValid, string memory notes) external',
            'function getProduct(uint256 productId) external view returns (tuple(uint256,string,string,string,address,uint256,uint256,bool,string,bytes32))',
            'function getShipment(uint256 shipmentId) external view returns (tuple(uint256,uint256,address,address,uint256,uint256,string,string,bytes32,bool))',
            'function getProductEvents(uint256 productId) external view returns (tuple(uint256,uint256,uint256,string,string,string,address,uint256,bytes32)[])',
            'function getProductTrace(uint256 productId) external view returns (tuple(uint256,string,string,string,address,uint256,uint256,bool,string,bytes32), tuple(uint256,uint256,uint256,string,string,string,address,uint256,bytes32)[], tuple(uint256,uint256,address,uint256,bool,string,bytes32)[])'
        ];

        this.contract = new ethers.Contract(this.contractAddress, this.contractABI, this.wallet);

        logger.info('✅ Traceability Service initialized');
    }

    // ============ Product Management ============

    async createProduct(productData) {
        try {
            const productHash = ethers.keccak256(
                ethers.toUtf8Bytes(JSON.stringify(productData))
            );

            const tx = await this.contract.createProduct(
                productData.name,
                productData.description || '',
                productData.category || 'general',
                productData.metadataURI || '',
                productHash,
                { gasLimit: 300000 }
            );
            const receipt = await tx.wait();

            const productId = await this.contract.getTotalProducts();

            await this.storeProduct({
                ...productData,
                productId: productId.toString(),
                txHash: receipt.hash
            });

            logger.info(`✅ Product created: ${productId}`);
            return {
                success: true,
                productId: productId.toString(),
                productHash,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Product creation failed:', error);
            throw error;
        }
    }

    // ============ Shipment Management ============

    async createShipment(productId, receiver, location) {
        try {
            const tx = await this.contract.createShipment(
                productId,
                receiver,
                location,
                { gasLimit: 200000 }
            );
            const receipt = await tx.wait();

            const shipmentId = await this.contract.getTotalShipments();

            await this.storeShipment({
                productId,
                shipmentId: shipmentId.toString(),
                receiver,
                location,
                txHash: receipt.hash
            });

            logger.info(`✅ Shipment created: ${shipmentId}`);
            return {
                success: true,
                shipmentId: shipmentId.toString(),
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Shipment creation failed:', error);
            throw error;
        }
    }

    async updateShipmentStatus(shipmentId, status, location) {
        try {
            const tx = await this.contract.updateShipmentStatus(
                shipmentId,
                status,
                location,
                { gasLimit: 150000 }
            );
            const receipt = await tx.wait();

            await this.updateShipmentInDB(shipmentId, status, location, receipt.hash);

            logger.info(`✅ Shipment status updated: ${shipmentId} -> ${status}`);
            return {
                success: true,
                shipmentId,
                status,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Shipment update failed:', error);
            throw error;
        }
    }

    // ============ Trace Events ============

    async addCustomEvent(productId, eventType, location, description) {
        try {
            const tx = await this.contract.addCustomEvent(
                productId,
                eventType,
                location,
                description,
                { gasLimit: 150000 }
            );
            const receipt = await tx.wait();

            await this.storeEvent({
                productId,
                eventType,
                location,
                description,
                txHash: receipt.hash
            });

            logger.info(`✅ Custom event added: ${eventType}`);
            return {
                success: true,
                eventType,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Custom event failed:', error);
            throw error;
        }
    }

    // ============ Verification ============

    async verifyProduct(productId, isValid, notes) {
        try {
            const tx = await this.contract.verifyProduct(
                productId,
                isValid,
                notes || '',
                { gasLimit: 150000 }
            );
            const receipt = await tx.wait();

            await this.storeVerification({
                productId,
                isValid,
                notes,
                txHash: receipt.hash
            });

            logger.info(`✅ Product verified: ${productId}`);
            return {
                success: true,
                productId,
                isValid,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Product verification failed:', error);
            throw error;
        }
    }

    // ============ View Functions ============

    async getProduct(productId) {
        try {
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
        } catch (error) {
            logger.error('Product fetch failed:', error);
            return null;
        }
    }

    async getShipment(shipmentId) {
        try {
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
        } catch (error) {
            logger.error('Shipment fetch failed:', error);
            return null;
        }
    }

    async getProductTrace(productId) {
        try {
            const trace = await this.contract.getProductTrace(productId);
            return {
                product: {
                    id: trace[0][0].toString(),
                    name: trace[0][1],
                    description: trace[0][2],
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
        } catch (error) {
            logger.error('Product trace fetch failed:', error);
            return null;
        }
    }

    // ============ Database Operations ============

    async storeProduct(data) {
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

    async storeShipment(data) {
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

    async updateShipmentInDB(shipmentId, status, location, txHash) {
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

    async storeEvent(data) {
        const { error } = await supabase
            .from('trace_events')
            .insert([{
                product_id: data.productId,
                event_type: data.eventType,
                location: data.location,
                description: data.description,
                tx_hash: data.txHash,
                created_at: new Date().toISOString()
            }]);
        if (error) throw error;
    }

    async storeVerification(data) {
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

    // ============ Statistics ============

    async getTraceabilityStats() {
        try {
            const { data: products } = await supabase
                .from('trace_products')
                .select('*');

            const { data: shipments } = await supabase
                .from('trace_shipments')
                .select('*');

            const { data: events } = await supabase
                .from('trace_events')
                .select('*');

            const { data: verifications } = await supabase
                .from('trace_verifications')
                .select('*');

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
            logger.error('Stats fetch failed:', error);
            return null;
        }
    }
}

export default new TraceabilityService();