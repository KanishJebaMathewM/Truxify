const OracleService = require('../src/services/oracle/OracleService');

describe('Oracle Service Tests', () => {
  test('should initialize with multiple providers', () => {
    const service = new OracleService({ consensusThreshold: 2 });
    expect(service.providers.length).toBeGreaterThan(0);
    expect(service.consensusThreshold).toBe(2);
  });

  test('should confirm delivery with M-of-N consensus', async () => {
    const service = new OracleService({ consensusThreshold: 2 });
    const result = await service.confirmDelivery({
      orderId: 'test-123',
      otp: '123456',
      gpsCoordinates: { lat: 28.6139, lng: 77.2090 }
    });
    expect(result).toHaveProperty('confirmed');
    expect(result).toHaveProperty('consensusCount');
  });
});