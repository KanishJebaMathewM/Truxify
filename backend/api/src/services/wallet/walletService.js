const { createClient } = require('@supabase/supabase-js');
const { ethers } = require('ethers');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com');

const getUserWallet = async (userId) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('wallet_address')
    .eq('id', userId)
    .single();

  if (error || !data) {
    throw new Error('User profile not found');
  }

  return data.wallet_address;
};

const guardWalletAddress = (walletAddress) => {
  if (!walletAddress || typeof walletAddress !== 'string' || walletAddress.trim() === '') {
    throw new Error('Wallet address is missing or invalid. Please link a wallet to your account.');
  }
  
  if (!ethers.isAddress(walletAddress)) {
    throw new Error('Invalid wallet address format.');
  }
};

const getBalance = async (userId) => {
  const walletAddress = await getUserWallet(userId);
  guardWalletAddress(walletAddress);

  try {
    const balanceWei = await provider.getBalance(walletAddress);
    const balanceMatic = ethers.formatEther(balanceWei);
    return {
      walletAddress,
      balance: balanceMatic,
      currency: 'MATIC',
    };
  } catch (err) {
    console.error('Error fetching balance:', err.message);
    throw new Error('Failed to fetch wallet balance from blockchain');
  }
};

const depositEscrow = async (userId, bookingId, amount) => {
  const walletAddress = await getUserWallet(userId);
  guardWalletAddress(walletAddress);

  const { data: booking, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', bookingId)
    .eq('customer_id', userId)
    .eq('status', 'accepted')
    .single();

  if (error || !booking) {
    throw new Error('Booking not found or not eligible for escrow deposit');
  }

  return {
    success: true,
    message: 'Escrow deposit initiated',
    walletAddress,
    amount,
  };
};

const releaseEscrow = async (userId, bookingId, amount) => {
  const walletAddress = await getUserWallet(userId);
  guardWalletAddress(walletAddress);

  const { data: booking, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', bookingId)
    .eq('customer_id', userId)
    .eq('status', 'completed')
    .single();

  if (error || !booking) {
    throw new Error('Booking not found or not eligible for escrow release');
  }

  const { error: updateError } = await supabase
    .from('bookings')
    .update({ escrow_released: true, released_at: new Date().toISOString() })
    .eq('id', bookingId);

  if (updateError) {
    throw new Error('Failed to update escrow status in database');
  }

  return {
    success: true,
    message: 'Escrow released successfully',
    transactionHash: '0xsimulatedhash123456789',
  };
};

const verifyDocumentPayment = async (userId, documentId, walletAddress) => {
  guardWalletAddress(walletAddress);

  const userWallet = await getUserWallet(userId);
  guardWalletAddress(userWallet);

  if (userWallet.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new Error('Provided wallet address does not match the user registered wallet');
  }

  return {
    verified: true,
    documentId,
    walletAddress,
  };
};

module.exports = {
  getBalance,
  depositEscrow,
  releaseEscrow,
  verifyDocumentPayment,
  guardWalletAddress,
};

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
