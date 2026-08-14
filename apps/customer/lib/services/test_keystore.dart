import 'keystore_binder.dart';

void main() async {
  print('Testing Hardware KeyStore Binder...');
  final service = HardwareKeyStoreBinder();

  final pubKey = await service.generateHardwareKeypair();
  if (!pubKey.startsWith('MOCK_HARDWARE_')) {
    print('✅ Hardware Key Generation test passed.');
  } else {
    print('❌ Hardware Key Generation still returns a mock public key.');
  }

  final payload = 'TEST_TRANSACTION_PAYLOAD';
  final sig1 = await service.signPayload(payload);
  final sig2 = await service.signPayload(payload);

  if (sig1 != sig2 && await service.verifySignature(payload, sig1)) {
    print('✅ Hardware Payload Signing test passed (non-deterministic & verifiable).');
  } else {
    print('❌ Hardware Payload Signing test failed.');
  }
}
