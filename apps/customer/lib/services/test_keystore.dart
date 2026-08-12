import 'keystore_binder.dart';

void main() async {
  print('Testing Hardware KeyStore Binder...');
  final service = HardwareKeyStoreBinder();

  final pubKey = await service.generateHardwareKeypair();
  if (pubKey.startsWith("MOCK_HARDWARE_")) {
    print('✅ Hardware Key Generation test passed.');
  }

  final sig = await service.signPayload("TEST_TRANSACTION_PAYLOAD");
  if (sig.startsWith("0xsignature_")) {
    print('✅ Hardware Payload Signing test passed.');
  }
}
