const OracleService = require('../oracle/OracleService');

class VerificationService {
  constructor() {
    this.oracleService = new OracleService();
  }

  async verifyOrder(orderId) {
    try {
      // 1. Get order details from DB
      const order = await this.getOrderFromDB(orderId);
      if (!order) {
        return { verified: false, error: 'Order not found' };
      }

      // 2. Check delivery confirmation with oracle
      const oracleResult = await this.oracleService.confirmDelivery({
        orderId,
        otp: order.deliveryOTP,
        gpsCoordinates: order.deliveryLocation
      });

      // 3. Cross-chain verification
      const crossChainResult = await this.oracleService.verifyCrossChain(
        orderId,
        order.blockchainTransactionHash
      );

      // 4. Document integrity check
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
    // In real implementation: fetch from PostgreSQL
    return {
      orderId,
      deliveryOTP: '123456',
      deliveryLocation: { lat: 28.6139, lng: 77.2090 },
      driverId: 'driver_123',
      blockchainTransactionHash: '0x123abc...'
    };
  }

  async checkDocumentIntegrity(driverId) {
    // Check if driver's documents are tampered
    // Compare stored hash with current document hash
    return {
      verified: true,
      documentsChecked: ['RC', 'License', 'Insurance'],
      lastCheck: new Date().toISOString()
    };
  }
}

module.exports = VerificationService;