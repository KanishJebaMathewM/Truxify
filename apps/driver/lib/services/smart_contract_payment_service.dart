import 'dart:async';
import '../models/smart_contract_payment_model.dart';

class SmartContractPaymentService {
  /// Simulates querying the blockchain for active escrow contracts
  Future<List<SmartContractPayment>> getActiveContracts() async {
    await Future.delayed(const Duration(seconds: 2));

    return [
      SmartContractPayment(
        contractId: '0x8f2a...4b1c',
        loadId: 'LD-99321',
        brokerName: 'TQL Logistics',
        amountUsd: 2150.00,
        cryptoEquivalent: '2150.00 USDC',
        geoFenceBreached: true,
        bolSigned: false,
        status: 'Awaiting BOL Signature',
      ),
      SmartContractPayment(
        contractId: '0x4a9b...7d2e',
        loadId: 'LD-88124',
        brokerName: 'C.H. Robinson',
        amountUsd: 1450.00,
        cryptoEquivalent: '1450.00 USDC',
        geoFenceBreached: false,
        bolSigned: false,
        status: 'Awaiting Delivery',
      )
    ];
  }

  /// Simulates triggering the final condition (signing BOL) to release funds
  Future<SmartContractPayment> executeSmartContract(SmartContractPayment contract) async {
    await Future.delayed(const Duration(seconds: 3));
    
    return SmartContractPayment(
      contractId: contract.contractId,
      loadId: contract.loadId,
      brokerName: contract.brokerName,
      amountUsd: contract.amountUsd,
      cryptoEquivalent: contract.cryptoEquivalent,
      geoFenceBreached: true,
      bolSigned: true,
      status: 'Settled',
      settlementTime: DateTime.now(),
    );
  }
}
