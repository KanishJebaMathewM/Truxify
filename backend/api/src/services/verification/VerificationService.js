import { supabase } from '../../config/db.js';
import OracleService from '../../oracle/OracleService.js';
import logger from '../../middleware/logger.js';

const REQUIRED_DOCUMENT_TYPES = ['rc_book', 'driving_licence'];

const ACTIVE_DELIVERY_STATUSES = new Set([
  'delivered',
  'payment_released',
]);

class VerificationService {
  constructor(deps = {}) {
    this.orderRepository = deps.orderRepository || null;
    this.oracleService = deps.oracleService || new OracleService();
    this.supabase = deps.supabase || supabase;
  }

  async verifyOrder(orderId) {
    try {
      const order = await this._getOrder(orderId);
      if (!order) {
        return { verified: false, error: 'Order not found' };
      }

      const [oracleResult, crossChainResult, documentIntegrity, driverVerification] = await Promise.all([
        this.oracleService.confirmDelivery({
          orderId,
          otp: order.delivery_otp,
          gpsCoordinates: null,
        }),
        order.blockchain_tx_hash
          ? this.oracleService.verifyCrossChain(orderId, order.blockchain_tx_hash)
          : Promise.resolve({ verified: false, ipfsHash: null }),
        order.driver_id ? this.checkDocumentIntegrity(order.driver_id) : Promise.resolve({ verified: false, documentsChecked: [], lastCheck: new Date().toISOString() }),
        this._verifyDriver(order.driver_id),
      ]);

      const deliveryVerified = oracleResult.confirmed && ACTIVE_DELIVERY_STATUSES.has(order.status);

      return {
        orderId,
        deliveryVerified,
        oracleDetails: {
          confirmed: oracleResult.confirmed,
          consensusCount: oracleResult.consensusCount,
          threshold: oracleResult.threshold,
          totalProviders: oracleResult.totalProviders,
          providerResults: oracleResult.providerResults,
          timestamp: oracleResult.timestamp,
        },
        crossChainVerified: crossChainResult.verified,
        ipfsHash: crossChainResult.ipfsHash,
        documentIntegrity,
        driverVerification: {
          verified: driverVerification.verified,
          driverActive: driverVerification.driverActive,
          documentsValid: documentIntegrity.verified,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('[VerificationService] verifyOrder error:', error.message);
      return {
        verified: false,
        error: error.message,
      };
    }
  }

  async _getOrder(orderId) {
    if (this.orderRepository) {
      const { data, error } = await this.orderRepository.findOrderById(
        orderId,
        'id, order_display_id, status, customer_id, driver_id, truck_id, delivery_otp, otp_verified, blockchain_tx_hash, escrow_status'
      );
      if (error) throw error;
      return data;
    }

    const { data, error } = await this.supabase
      .from('orders')
      .select('id, order_display_id, status, customer_id, driver_id, truck_id, delivery_otp, otp_verified, blockchain_tx_hash, escrow_status')
      .eq('id', orderId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async _verifyDriver(driverId) {
    if (!driverId) {
      return { verified: false, driverActive: false, reason: 'No driver assigned' };
    }

    try {
      const { data: profile, error: profileErr } = await this.supabase
        .from('profiles')
        .select('id, is_active, role')
        .eq('id', driverId)
        .maybeSingle();

      if (profileErr) {
        logger.warn('[VerificationService] Driver profile lookup error:', profileErr.message);
        return { verified: false, driverActive: false, reason: 'Database error' };
      }

      if (!profile) {
        return { verified: false, driverActive: false, reason: 'Driver not found' };
      }

      if (profile.role !== 'driver') {
        return { verified: false, driverActive: false, reason: 'User is not a driver' };
      }

      if (!profile.is_active) {
        return { verified: false, driverActive: false, reason: 'Driver account is inactive' };
      }

      return { verified: true, driverActive: true };
    } catch (err) {
      logger.error('[VerificationService] Driver verification error:', err.message);
      return { verified: false, driverActive: false, reason: err.message };
    }
  }

  async checkDocumentIntegrity(driverId) {
    if (!driverId) {
      return {
        verified: false,
        documentsChecked: REQUIRED_DOCUMENT_TYPES.map(type => ({
          type,
          uploaded: false,
          status: 'missing',
        })),
        lastCheck: new Date().toISOString(),
      };
    }

    try {
      const { data: documents, error } = await this.supabase
        .from('driver_documents')
        .select('document_type, status, created_at')
        .eq('driver_id', driverId);

      if (error) throw error;

      const docsByType = new Map();
      for (const doc of (documents || [])) {
        const existing = docsByType.get(doc.document_type);
        if (!existing || doc.status === 'approved') {
          docsByType.set(doc.document_type, doc);
        }
      }

      const checkedTypes = REQUIRED_DOCUMENT_TYPES.map(type => {
        const doc = docsByType.get(type);
        return {
          type,
          uploaded: !!doc,
          status: doc ? doc.status : 'missing',
        };
      });

      const allPresent = checkedTypes.every(t => t.uploaded);
      const allApproved = checkedTypes.every(t => t.status === 'approved');

      return {
        verified: allPresent && allApproved,
        documentsChecked: checkedTypes,
        lastCheck: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('[VerificationService] checkDocumentIntegrity error:', error.message);
      return {
        verified: false,
        documentsChecked: REQUIRED_DOCUMENT_TYPES.map(type => ({
          type,
          uploaded: false,
          status: 'error',
        })),
        lastCheck: new Date().toISOString(),
        error: error.message,
      };
    }
  }
}

export default VerificationService;
