import { ethers } from 'ethers';
import logger from '../../api/src/middleware/logger.js';
import { supabase } from '../../api/src/config/db.js';

class TokenizationService {
    constructor() {
        this.provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
        this.tokenAddress = process.env.ASSET_TOKEN_ADDRESS;

        this.tokenABI = [
            'function createAsset(string memory name, string memory description, string memory assetType, uint256 totalValue, uint256 totalTokens, string memory metadataURI) external returns (uint256)',
            'function purchaseFraction(uint256 assetId, uint256 amount) external payable',
            'function sellFraction(uint256 assetId, uint256 amount) external',
            'function createTradeOrder(uint256 assetId, uint256 amount, uint256 price, string memory orderType) external',
            'function executeTradeOrder(uint256 assetId, uint256 orderIndex) external payable',
            'function cancelTradeOrder(uint256 assetId, uint256 orderIndex) external',
            'function getAsset(uint256 assetId) external view returns (tuple(uint256,string,string,string,uint256,uint256,uint256,uint256,address,bool,string,uint256,uint256))',
            'function getFractionalOwnership(uint256 assetId, address owner) external view returns (tuple(address,uint256,uint256,uint256))',
            'function getTotalAssets() external view returns (uint256)',
            'function getTotalTradeOrders() external view returns (uint256)'
        ];

        this.token = new ethers.Contract(this.tokenAddress, this.tokenABI, this.wallet);

        logger.info('✅ Tokenization Service initialized');
    }

    // ============ Asset Management ============

    async createAsset(assetData) {
        try {
            const tx = await this.token.createAsset(
                assetData.name,
                assetData.description,
                assetData.assetType,
                ethers.parseEther(assetData.totalValue.toString()),
                ethers.parseEther(assetData.totalTokens.toString()),
                assetData.metadataURI || '',
                { gasLimit: 500000 }
            );
            const receipt = await tx.wait();

            // Get asset ID from logs
            const assetId = await this.token.getTotalAssets();

            await this.storeAsset({
                ...assetData,
                assetId: assetId.toString(),
                txHash: receipt.hash
            });

            logger.info(`✅ Asset created: ${assetId}`);
            return {
                success: true,
                assetId: assetId.toString(),
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Asset creation failed:', error);
            throw error;
        }
    }

    async purchaseFraction(assetId, amount, userAddress) {
        try {
            const asset = await this.getAsset(assetId);
            const totalCost = parseFloat(asset.tokenPrice) * amount;

            const tx = await this.token.purchaseFraction(
                assetId,
                ethers.parseEther(amount.toString()),
                {
                    value: ethers.parseEther(totalCost.toString()),
                    gasLimit: 200000
                }
            );
            const receipt = await tx.wait();

            await this.storeTransaction({
                assetId,
                userAddress,
                amount,
                totalCost,
                type: 'purchase',
                txHash: receipt.hash
            });

            logger.info(`✅ Fraction purchased: ${assetId}`);
            return {
                success: true,
                assetId,
                amount,
                totalCost,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Fraction purchase failed:', error);
            throw error;
        }
    }

    async sellFraction(assetId, amount, userAddress) {
        try {
            const tx = await this.token.sellFraction(
                assetId,
                ethers.parseEther(amount.toString()),
                { gasLimit: 150000 }
            );
            const receipt = await tx.wait();

            await this.storeTransaction({
                assetId,
                userAddress,
                amount,
                type: 'sell',
                txHash: receipt.hash
            });

            logger.info(`✅ Fraction sold: ${assetId}`);
            return {
                success: true,
                assetId,
                amount,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Fraction sale failed:', error);
            throw error;
        }
    }

    // ============ Trading ============

    async createTradeOrder(assetId, amount, price, orderType, userAddress) {
        try {
            const tx = await this.token.createTradeOrder(
                assetId,
                ethers.parseEther(amount.toString()),
                ethers.parseEther(price.toString()),
                orderType,
                { gasLimit: 200000 }
            );
            const receipt = await tx.wait();

            const orderId = await this.token.getTotalTradeOrders();

            await this.storeTradeOrder({
                assetId,
                orderId: orderId.toString(),
                userAddress,
                amount,
                price,
                orderType,
                txHash: receipt.hash
            });

            logger.info(`✅ Trade order created: ${orderId}`);
            return {
                success: true,
                orderId: orderId.toString(),
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Trade order creation failed:', error);
            throw error;
        }
    }

    async executeTradeOrder(assetId, orderIndex, buyerAddress) {
        try {
            const order = await this.getTradeOrder(assetId, orderIndex);
            const totalCost = parseFloat(order.price) * parseFloat(order.amount);

            const tx = await this.token.executeTradeOrder(
                assetId,
                orderIndex,
                {
                    value: ethers.parseEther(totalCost.toString()),
                    gasLimit: 200000
                }
            );
            const receipt = await tx.wait();

            await this.storeTransaction({
                assetId,
                userAddress: buyerAddress,
                amount: order.amount,
                totalCost,
                type: 'trade',
                txHash: receipt.hash,
                orderId: order.orderId
            });

            logger.info(`✅ Trade order executed: ${order.orderId}`);
            return {
                success: true,
                orderId: order.orderId,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Trade order execution failed:', error);
            throw error;
        }
    }

    // ============ View Functions ============

    async getAsset(assetId) {
        try {
            const asset = await this.token.getAsset(assetId);
            return {
                id: asset[0].toString(),
                name: asset[1],
                description: asset[2],
                assetType: asset[3],
                totalValue: ethers.formatEther(asset[4]),
                tokenPrice: ethers.formatEther(asset[5]),
                totalTokens: ethers.formatEther(asset[6]),
                availableTokens: ethers.formatEther(asset[7]),
                owner: asset[8],
                isActive: asset[9],
                metadataURI: asset[10],
                createdAt: asset[11].toString(),
                updatedAt: asset[12].toString()
            };
        } catch (error) {
            logger.error('Asset fetch failed:', error);
            return null;
        }
    }

    async getFractionalOwnership(assetId, userAddress) {
        try {
            const ownership = await this.token.getFractionalOwnership(assetId, userAddress);
            return {
                owner: ownership[0],
                tokenId: ownership[1].toString(),
                amount: ethers.formatEther(ownership[2]),
                purchasedAt: ownership[3].toString()
            };
        } catch (error) {
            logger.error('Fractional ownership fetch failed:', error);
            return null;
        }
    }

    async getStats() {
        try {
            const totalAssets = await this.token.getTotalAssets();
            const totalOrders = await this.token.getTotalTradeOrders();

            const { data: assets } = await supabase
                .from('tokenized_assets')
                .select('*');

            const { data: transactions } = await supabase
                .from('token_transactions')
                .select('*');

            return {
                totalAssets: totalAssets.toString(),
                totalTradeOrders: totalOrders.toString(),
                totalAssetsInDB: assets?.length || 0,
                totalTransactions: transactions?.length || 0,
                totalVolume: transactions?.reduce((sum, t) => sum + parseFloat(t.total_cost || 0), 0) || 0,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Stats fetch failed:', error);
            return null;
        }
    }

    // ============ Database Operations ============

    async storeAsset(data) {
        const { error } = await supabase
            .from('tokenized_assets')
            .insert([{
                asset_id: data.assetId,
                name: data.name,
                description: data.description,
                asset_type: data.assetType,
                total_value: data.totalValue,
                total_tokens: data.totalTokens,
                tx_hash: data.txHash,
                created_at: new Date().toISOString()
            }]);
        if (error) throw error;
    }

    async storeTransaction(data) {
        const { error } = await supabase
            .from('token_transactions')
            .insert([{
                asset_id: data.assetId,
                user_address: data.userAddress,
                amount: data.amount,
                total_cost: data.totalCost || 0,
                type: data.type,
                tx_hash: data.txHash,
                order_id: data.orderId,
                created_at: new Date().toISOString()
            }]);
        if (error) throw error;
    }

    async storeTradeOrder(data) {
        const { error } = await supabase
            .from('trade_orders')
            .insert([{
                order_id: data.orderId,
                asset_id: data.assetId,
                user_address: data.userAddress,
                amount: data.amount,
                price: data.price,
                order_type: data.orderType,
                tx_hash: data.txHash,
                status: 'active',
                created_at: new Date().toISOString()
            }]);
        if (error) throw error;
    }
}

export default new TokenizationService();