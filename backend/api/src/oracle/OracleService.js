import { supabase } from '../config/db.js';
import logger from '../middleware/logger.js';

const DELIVERY_COMPLETED_STATUSES = new Set([
  'delivered',
  'payment_released',
]);

class OracleService {
  constructor(deps = {}) {
    this.orderRepository = deps.orderRepository || null;
    this.supabase = deps.supabase || supabase;
  }

  async confirmDelivery({ orderId, otp, gpsCoordinates }) {
    const providerResults = [];

    const otpResult = await this._verifyOTP(orderId, otp);
    providerResults.push(otpResult);

    const gpsResult = this._verifyGPS(gpsCoordinates);
    providerResults.push(gpsResult);

    const statusResult = await this._verifyOrderStatus(orderId);
    providerResults.push(statusResult);

    const confirmedCount = providerResults.filter(r => r.confirmed === true).length;
    const totalProviders = providerResults.length;
    const hasConsensus = confirmedCount >= 2;

    await this.logOracleResult(orderId, providerResults, hasConsensus);

    return {
      confirmed: hasConsensus,
      consensusCount: confirmedCount,
      threshold: 2,
      totalProviders,
      providerResults,
      timestamp: new Date().toISOString(),
    };
  }

  async _verifyOTP(orderId, otp) {
    try {
      const { data: order, error: orderErr } = await this.supabase
        .from('orders')
        .select('id, otp_verified')
        .eq('id', orderId)
        .maybeSingle();

      if (orderErr) {
        logger.warn('[OracleService] OTP verification DB error:', orderErr.message);
        return { confirmed: false, provider: 'OTPVerifier', error: orderErr.message, timestamp: new Date().toISOString() };
      }

      if (!order) {
        return { confirmed: false, provider: 'OTPVerifier', reason: 'Order not found', timestamp: new Date().toISOString() };
      }

      const { data: otpRecord } = await this.supabase
        .from('delivery_otps')
        .select('id, verified')
        .eq('order_id', orderId)
        .eq('verified', true)
        .limit(1)
        .maybeSingle();

      const isVerified = order.otp_verified === true || (otpRecord && otpRecord.verified === true);

      return {
        confirmed: isVerified,
        provider: 'OTPVerifier',
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      logger.error('[OracleService] OTP verification error:', err.message);
      return { confirmed: false, provider: 'OTPVerifier', error: err.message, timestamp: new Date().toISOString() };
    }
  }

  _verifyGPS(gpsCoordinates) {
    const hasValidCoords = gpsCoordinates &&
      typeof gpsCoordinates.lat === 'number' &&
      typeof gpsCoordinates.lng === 'number' &&
      gpsCoordinates.lat >= -90 && gpsCoordinates.lat <= 90 &&
      gpsCoordinates.lng >= -180 && gpsCoordinates.lng <= 180;

    return {
      confirmed: hasValidCoords === true,
      provider: 'GPSVerifier',
      timestamp: new Date().toISOString(),
    };
  }

  async _verifyOrderStatus(orderId) {
    try {
      const { data: order, error } = await this.supabase
        .from('orders')
        .select('id, status')
        .eq('id', orderId)
        .maybeSingle();

      if (error) {
        logger.warn('[OracleService] Status verification DB error:', error.message);
        return { confirmed: false, provider: 'StatusVerifier', error: error.message, timestamp: new Date().toISOString() };
      }

      if (!order) {
        return { confirmed: false, provider: 'StatusVerifier', reason: 'Order not found', timestamp: new Date().toISOString() };
      }

      return {
        confirmed: DELIVERY_COMPLETED_STATUSES.has(order.status),
        provider: 'StatusVerifier',
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      logger.error('[OracleService] Status verification error:', err.message);
      return { confirmed: false, provider: 'StatusVerifier', error: err.message, timestamp: new Date().toISOString() };
    }
  }

  async logOracleResult(orderId, results, hasConsensus) {
    const logEntry = {
      orderId,
      timestamp: new Date().toISOString(),
      results: results.map(r => ({
        provider: r.provider,
        confirmed: r.confirmed,
        error: r.error || undefined,
        reason: r.reason || undefined,
      })),
      consensusReached: hasConsensus,
    };

    logger.info('[OracleService] Verification result:', JSON.stringify(logEntry));
    return logEntry;
  }

  async verifyCrossChain(orderId, blockchainHash) {
    try {
      const { data: order, error } = await this.supabase
        .from('orders')
        .select('id, blockchain_tx_hash, escrow_status')
        .eq('id', orderId)
        .maybeSingle();

      if (error) {
        logger.warn('[OracleService] Cross-chain verification DB error:', error.message);
        return { verified: false, ipfsHash: null, blockchainHash, verificationUrl: null, error: error.message };
      }

      if (!order) {
        return { verified: false, ipfsHash: null, blockchainHash, verificationUrl: null, error: 'Order not found' };
      }

      const hashMatch = order.blockchain_tx_hash &&
        order.blockchain_tx_hash.toLowerCase() === blockchainHash.toLowerCase();

      const escrowValid = order.escrow_status === 'funded' || order.escrow_status === 'released';

      const verified = hashMatch && escrowValid;

      return {
        verified,
        ipfsHash: order.blockchain_tx_hash || null,
        blockchainHash,
        verificationUrl: order.blockchain_tx_hash
          ? `https://polygonscan.com/tx/${order.blockchain_tx_hash}`
          : null,
      };
    } catch (err) {
      logger.error('[OracleService] Cross-chain verification error:', err.message);
      return { verified: false, ipfsHash: null, blockchainHash, verificationUrl: null, error: err.message };
    }
  }
}

export default OracleService;
