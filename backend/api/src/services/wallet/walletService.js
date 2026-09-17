import { ethers } from 'ethers';
import { DomainError } from '../order/domainError.js';
import logger from '../../middleware/logger.js';

/**
 * Validates and guards wallet address operations.
 * Prevents TypeError on null/undefined addresses and returns clean 400 Bad Request.
 */
export async function validateWalletAddress(walletAddress) {
    if (!walletAddress || typeof walletAddress !== 'string') {
        throw new DomainError(400, { error: 'Wallet address is required and must be a valid string.' });
    }
    if (!ethers.isAddress(walletAddress)) {
        throw new DomainError(400, { error: `Invalid Ethereum/Polygon wallet address format: "${walletAddress}".` });
    }
    return walletAddress;
}

export async function getWalletDetails(walletAddress) {
    const validatedAddress = await validateWalletAddress(walletAddress);
    logger.info(`[WalletService] Fetching details for wallet: ${validatedAddress}`);
    
    // Core wallet lookup logic placeholder
    return {
        walletAddress: validatedAddress,
        isActive: true,
        network: 'polygon'
    };
}
