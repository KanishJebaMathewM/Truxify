import 'dart:async';
import '../models/bol_smart_contract_model.dart';

class BolSmartContractService {
  final _contractController = StreamController<SmartContractBol>.broadcast();

  Stream<SmartContractBol> get contractStream => _contractController.stream;

  void simulateDeliveryAndPayout() async {
    // 1. Awaiting Delivery
    _contractController.add(SmartContractBol(
      contractId: '0x8fB3...72a9',
      blockHash: 'Pending Delivery Execution',
      shipper: 'Samsung Electronics - Austin',
      receiver: 'Best Buy Distribution - Dallas',
      payoutAmount: 1850.00,
      status: 'Awaiting Delivery Verification',
      items: [
        BolItem(sku: 'SAM-QLED-65', description: '65" QLED 4K TVs', quantity: 120, weightLbs: 6500),
        BolItem(sku: 'SAM-S24-U', description: 'Galaxy S24 Ultra Pallets', quantity: 12, weightLbs: 1200),
      ],
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Receiver Scanning/Signing
    _contractController.add(SmartContractBol(
      contractId: '0x8fB3...72a9',
      blockHash: 'Pending Signature Consensus',
      shipper: 'Samsung Electronics - Austin',
      receiver: 'Best Buy Distribution - Dallas',
      payoutAmount: 1850.00,
      status: 'Receiver Scanning Cryptographic Signature...',
      items: [
        BolItem(sku: 'SAM-QLED-65', description: '65" QLED 4K TVs', quantity: 120, weightLbs: 6500),
        BolItem(sku: 'SAM-S24-U', description: 'Galaxy S24 Ultra Pallets', quantity: 12, weightLbs: 1200),
      ],
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Contract Executed, Funds Released
    _contractController.add(SmartContractBol(
      contractId: '0x8fB3...72a9',
      blockHash: '0xab42c98d7f6a...e311b',
      shipper: 'Samsung Electronics - Austin',
      receiver: 'Best Buy Distribution - Dallas',
      payoutAmount: 1850.00,
      status: 'Contract Executed - Funds Released to Wallet',
      items: [
        BolItem(sku: 'SAM-QLED-65', description: '65" QLED 4K TVs', quantity: 120, weightLbs: 6500),
        BolItem(sku: 'SAM-S24-U', description: 'Galaxy S24 Ultra Pallets', quantity: 12, weightLbs: 1200),
      ],
    ));
  }

  void dispose() {
    _contractController.close();
  }
}
