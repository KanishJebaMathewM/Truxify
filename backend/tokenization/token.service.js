import { ethers } from 'ethers';
import logger from '../api/src/middleware/logger.js';
import { supabase } from '../api/src/config/db.js';

const WEI_UNIT = 10n ** 18n;

/**
 * Compute the exact wei cost of an amount of tokens at a given price.
 *
 * Both inputs are decimal strings (e.g. "0.1" ETH/token and "3" tokens). The
 * contract multiplies the two wei values and divides by 1e18, so we replicate
 * that with integer math only — no `parseFloat` — which avoids the float
 * drift that previously lost wei (e.g. 0.1 * 3 rounded to 0.30000000000000004).
 *
 * @param {string|number} price   price per token in ether units
 * @param {string|number} amount  number of tokens in ether units
 * @param {boolean} roundUp       match the contract's ceiling (purchase) vs floor (trade)
 * @returns {bigint} total cost in wei
 */
function tokenCostWei(price, amount, roundUp = true) {
    const priceWei = ethers.parseEther(price.toString());
    const amountWei = ethers.parseEther(amount.toString());
    const product = priceWei * amountWei;
    return roundUp ? (product + WEI_UNIT - 1n) / WEI_UNIT : product / WEI_UNIT;
}

/**
 * Extract an argument from the first matching event in a transaction receipt.
 *
 * The on-chain asset/trade IDs are assigned inside the same transaction that
 * performs the mint/order, so reading them from the emitted event is
 * race-free. This replaces the previous `getTotalAssets()` / `getTotalTradeOrders()`
 * counters, which were a TOCTOU: after the tx was mined but before the count
 * was read, a concurrent create could shift the value and produce a wrong ID.
 *
 * @param {object} receipt  ethers v6 transaction receipt with `.logs`
 * @param {object} contract ethers Contract (or object exposing `.interface`)
 * @param {string} eventName
 * @param {number} argIndex
 * @returns {any} the requested event argument, or null if not found
 */
function extractEventArg(receipt, contract, eventName, argIndex = 0) {
    if (!receipt || !contract || !contract.interface) return null;
    for (const log of receipt.logs || []) {
        try {
            const parsed = contract.interface.parseLog(log);
            if (parsed && parsed.name === eventName) {
                return parsed.args[argIndex];
            }
        } catch {
            // log emitted by a different contract / not decodable here
        }
    }
    return null;
}

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
            'function getTradeOrders(uint256 assetId) external view returns (tuple(uint256,uint256,address,address,uint256,uint256,uint256,string,bool,uint256,uint256)[])',
            'function getAsset(uint256 assetId) external view returns (tuple(uint256,string,string,string,uint256,uint256,uint256,uint256,address,bool,string,uint256,uint256))',
            'function getFractionalOwnership(uint256 assetId, address owner) external view returns (tuple(address,uint256,uint256,uint256,uint256))',
            'function getTotalAssets() external view returns (uint256)',
            'function getTotalTradeOrders() external view returns (uint256)',
            'event AssetCreated(uint256 indexed assetId, string name, address indexed owner)',
            'event TradeOrderCreated(uint256 indexed orderId, uint256 tokenId, address indexed seller)'
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

            // Derive the asset ID from the emitted event (race-free) instead of
            // reading the asset counter, which is a TOCTOU after mining.
            const assetId = extractEventArg(receipt, this.token, 'AssetCreated', 0);

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

    async purchaseFraction(assetId, amount, userAddress, signer) {
        try {
            const asset = await this.getAsset(assetId);
            if (!asset) {
                throw new Error('Asset not found');
            }
            const totalCost = tokenCostWei(asset.tokenPrice, amount, true);

            const userContract = new ethers.Contract(this.tokenAddress, this.tokenABI, signer || this.wallet);
            const tx = await userContract.purchaseFraction(
                assetId,
                ethers.parseEther(amount.toString()),
                {
                    value: totalCost,
                    gasLimit: 200000
                }
            );
            const receipt = await tx.wait();

            await this.storeTransaction({
                assetId,
                userAddress,
                amount,
                totalCost: ethers.formatEther(totalCost),
                type: 'purchase',
                txHash: receipt.hash
            });

            logger.info(`✅ Fraction purchased: ${assetId}`);
            return {
                success: true,
                assetId,
                amount,
                totalCost: ethers.formatEther(totalCost),
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Fraction purchase failed:', error);
            throw error;
        }
    }

    async sellFraction(assetId, amount, userAddress, signer) {
        try {
            const userContract = new ethers.Contract(this.tokenAddress, this.tokenABI, signer);
            const tx = await userContract.sellFraction(
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

            // Derive the order ID from the emitted event (race-free) instead of
            // reading the trade counter, which is a TOCTOU after mining.
            const orderId = extractEventArg(receipt, this.token, 'TradeOrderCreated', 0);

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

    async getTradeOrder(assetId, orderIndex) {
        try {
            const orders = await this.token.getTradeOrders(assetId);

            if (orderIndex < 0 || orderIndex >= orders.length) {
                throw new Error(`Order index ${orderIndex} out of range for asset ${assetId}`);
            }
            const order = orders[orderIndex];
            return {
                orderId: order[0].toString(),
                tokenId: order[1].toString(),
                seller: order[2],
                buyer: order[3],
                amount: ethers.formatEther(order[4]),
                price: ethers.formatEther(order[6]),
                orderType: order[7],
                isActive: order[8]
            };
        } catch (error) {
            logger.error('Failed to get trade order:', error);
            throw error;
        }
}

    async executeTradeOrder(assetId, orderIndex, buyerAddress) {
        try {
            const order = await this.getTradeOrder(assetId, orderIndex);

            if (!order.isActive) {
                throw new Error(`Trade order ${order.orderId} is not active`);
            }

            const totalCost = tokenCostWei(order.price, order.amount, false);

            const tx = await this.token.executeTradeOrder(
                assetId,
                orderIndex,
                {
                    value: totalCost,
                    gasLimit: 200000
                }
            );
            const receipt = await tx.wait();

            await this.storeTransaction({
                assetId,
                userAddress: buyerAddress,
                amount: order.amount,
                totalCost: ethers.formatEther(totalCost),
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
                backedTokens: ethers.formatEther(ownership[3]),
                purchasedAt: ownership[4].toString()
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