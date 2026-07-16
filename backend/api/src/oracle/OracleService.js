const axios = require('axios');
const CircuitBreaker = require('circuit-breaker-js');

class OracleService {
  constructor(config = {}) {
    this.providers = [];
    this.consensusThreshold = config.consensusThreshold || 2;
    this.circuitBreaker = new CircuitBreaker(config.circuitBreaker || {
      failureThreshold: 3,
      timeout: 5000
    });
    this.initializeProviders();
  }

  initializeProviders() {
    // Provider 1: Chainlink
    if (process.env.CHAINLINK_ENABLED === 'true') {
      const chainlinkUrl = process.env.CHAINLINK_API_URL || 'http://localhost:8545';
      const chainlinkApiKey = process.env.CHAINLINK_API_KEY;
      this.providers.push({
        name: 'Chainlink',
        url: chainlinkUrl,
        apiKey: chainlinkApiKey,
        confirmDelivery: async (data) => {
          const response = await axios.post(`${chainlinkUrl}/verify-delivery`, data, {
            headers: { 'X-API-Key': chainlinkApiKey }
          });
          return response.data;
        }
      });
    }

    // Provider 2: Custom GPS+OTP Verifier
    this.providers.push({
      name: 'CustomVerifier',
      confirmDelivery: async (data) => {
        // Simulate GPS+OTP verification
        const { orderId, otp, gpsCoordinates } = data;
        // In real implementation: check OTP from DB and GPS from tracking
        const isValid = await this.verifyOTPAndGPS(orderId, otp, gpsCoordinates);
        return {
          confirmed: isValid,
          provider: 'CustomVerifier',
          timestamp: new Date().toISOString()
        };
      }
    });

    // Provider 3: Backup/Third Party
    if (process.env.BACKUP_ORACLE_ENABLED === 'true') {
      const backupUrl = process.env.BACKUP_ORACLE_URL;
      this.providers.push({
        name: 'BackupOracle',
        url: backupUrl,
        confirmDelivery: async (data) => {
          const response = await axios.post(`${backupUrl}/confirm`, data);
          return response.data;
        }
      });
    }
  }

  async verifyOTPAndGPS(orderId, otp, gpsCoordinates) {
    // This would check against database records
    // For now, returning true for demo
    return true;
  }

  async confirmDelivery(orderData) {
    const { orderId, otp, gpsCoordinates } = orderData;
    
    // Get confirmations from all providers with circuit breaker
    const results = await Promise.allSettled(
      this.providers.map(provider => 
        this.circuitBreaker.run(() => 
          provider.confirmDelivery({ orderId, otp, gpsCoordinates })
        ).catch(err => ({ error: err.message }))
      )
    );

    // Apply M-of-N consensus
    const successfulConfirmations = results.filter(r => 
      r.status === 'fulfilled' && r.value && r.value.confirmed === true
    );

    const hasConsensus = successfulConfirmations.length >= this.consensusThreshold;

    // Log results to MongoDB
    await this.logOracleResult(orderId, results, hasConsensus);

    return {
      confirmed: hasConsensus,
      consensusCount: successfulConfirmations.length,
      threshold: this.consensusThreshold,
      totalProviders: this.providers.length,
      providerResults: results.map(r => ({
        status: r.status,
        value: r.status === 'fulfilled' ? r.value : r.reason
      })),
      timestamp: new Date().toISOString()
    };
  }

  async logOracleResult(orderId, results, hasConsensus) {
    // Store in MongoDB for audit trail
    const logEntry = {
      orderId,
      timestamp: new Date().toISOString(),
      results: results.map(r => ({
        status: r.status,
        value: r.status === 'fulfilled' ? r.value : r.reason
      })),
      consensusReached: hasConsensus
    };
    
    // In real implementation: save to MongoDB
    // await mongoClient.collection('oracle_logs').insertOne(logEntry);
    console.log('Oracle Result Logged:', logEntry);
    return logEntry;
  }

  async verifyCrossChain(orderId, blockchainHash) {
    // Verify delivery hash across chains
    // Store hash in IPFS/Arweave
    const ipfsHash = await this.storeOnIPFS({
      orderId,
      blockchainHash,
      verificationTimestamp: new Date().toISOString()
    });

    return {
      verified: true,
      ipfsHash,
      blockchainHash,
      verificationUrl: `https://ipfs.io/ipfs/${ipfsHash}`
    };
  }

  async storeOnIPFS(data) {
    // In real implementation: use IPFS HTTP API
    // For demo, return fake hash
    return `Qm${Math.random().toString(36).substring(7)}`;
  }
}

module.exports = OracleService;