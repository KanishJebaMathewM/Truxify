import { supabase } from '../../config/db.js';
import OracleService from '../oracle/OracleService.js';

const REQUIRED_DOCUMENT_TYPES = ['RC', 'License', 'Insurance'];

class VerificationService {
  constructor() {
    this.oracleService = new OracleService();
  }

  async verifyOrder(orderId) {
    try {
      const order = await this.getOrderFromDB(orderId);
      if (!order) {
        return { verified: false, error: 'Order not found' };
      }

      const oracleResult = await this.oracleService.confirmDelivery({
        orderId,
        otp: order.deliveryOTP,
        gpsCoordinates: order.deliveryLocation
      });

      const crossChainResult = await this.oracleService.verifyCrossChain(
        orderId,
        order.blockchainTransactionHash
      );

      const documentIntegrity = await this.checkDocumentIntegrity(order.driverId);

      return {
        orderId,
        deliveryVerified: oracleResult.confirmed,
        oracleDetails: oracleResult,
        crossChainVerified: crossChainResult.verified,
        ipfsHash: crossChainResult.ipfsHash,
        documentIntegrity: documentIntegrity,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        verified: false,
        error: error.message
      };
    }
  }

  async getOrderFromDB(orderId) {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async checkDocumentIntegrity(driverId) {
    const { data: documents, error } = await supabase
      .from('driver_documents')
      .select('document_type, status, created_at')
      .eq('driver_id', driverId);

    if (error) throw error;

    const uploadedTypes = new Set(
      (documents || []).map(d => d.document_type)
    );

    const checkedTypes = REQUIRED_DOCUMENT_TYPES.map(type => ({
      type,
      uploaded: uploadedTypes.has(type),
      status: uploadedTypes.has(type)
        ? (documents.find(d => d.document_type === type)?.status || 'unknown')
        : 'missing'
    }));

    const allPresent = checkedTypes.every(t => t.uploaded);
    const anyRejected = checkedTypes.some(t => t.status === 'rejected');

    return {
      verified: allPresent && !anyRejected,
      documentsChecked: checkedTypes,
      lastCheck: new Date().toISOString()
    };
  }
}

export default VerificationService;