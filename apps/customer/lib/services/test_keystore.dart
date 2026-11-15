import 'package:flutter/foundation.dart';

import 'keystore_binder.dart';

void main() async {
  debugPrint('Testing Hardware KeyStore Binder...');
  final service = HardwareKeyStoreBinder();

  final pubKey = await service.generateHardwareKeypair();
  if (!pubKey.startsWith('MOCK_HARDWARE_')) {
    debugPrint('✅ Hardware Key Generation test passed.');
  } else {
    debugPrint('❌ Hardware Key Generation still returns a mock public key.');
  }

  final payload = 'TEST_TRANSACTION_PAYLOAD';
  final sig1 = await service.signPayload(payload);
  final sig2 = await service.signPayload(payload);

  if (sig1 != sig2 && await service.verifySignature(payload, sig1)) {
    debugPrint('✅ Hardware Payload Signing test passed (non-deterministic & verifiable).');
  } else {
    debugPrint('❌ Hardware Payload Signing test failed.');
  }
}
