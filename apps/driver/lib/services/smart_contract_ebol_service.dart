import 'dart:async';
import '../models/smart_contract_ebol_model.dart';

class SmartContractEbolService {
  final _sessionController = StreamController<EbolSession>.broadcast();

  Stream<EbolSession> get ebolStream => _sessionController.stream;

  void simulateDeliveryExecution() async {
    // 1. Initial Arrival
    _sessionController.add(EbolSession(
      loadId: 'LD-88914-ATL',
      receiverName: 'Amazon FBA - ATL2',
      isGeofenceVerified: true, // Driver breached geofence
      isReceiverSigned: false,
      transaction: BlockchainTransaction(
        transactionHash: '0x39a8...9f12',
        timestamp: 'Waiting for receiver signature...',
        status: 'Pending Signatures',
        loadPayoutUsd: 1450.0,
        receiverWalletAddress: '0xAMZN...882a',
        carrierWalletAddress: '0xTRUX...511c',
      ),
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Receiver Signs -> Contract Executing
    _sessionController.add(EbolSession(
      loadId: 'LD-88914-ATL',
      receiverName: 'Amazon FBA - ATL2',
      isGeofenceVerified: true,
      isReceiverSigned: true, // Receiver just signed iPad
      transaction: BlockchainTransaction(
        transactionHash: '0x39a8...9f12',
        timestamp: DateTime.now().toIso8601String(),
        status: 'Executing Smart Contract...',
        loadPayoutUsd: 1450.0,
        receiverWalletAddress: '0xAMZN...882a',
        carrierWalletAddress: '0xTRUX...511c',
      ),
    ));
    
    await Future.delayed(const Duration(seconds: 3));

    // 3. Funds Released
    _sessionController.add(EbolSession(
      loadId: 'LD-88914-ATL',
      receiverName: 'Amazon FBA - ATL2',
      isGeofenceVerified: true,
      isReceiverSigned: true,
      transaction: BlockchainTransaction(
        transactionHash: '0x39a8...9f12',
        timestamp: DateTime.now().toIso8601String(),
        status: 'FUNDS RELEASED VIA ACH', // Smart contract releases escrow
        loadPayoutUsd: 1450.0,
        receiverWalletAddress: '0xAMZN...882a',
        carrierWalletAddress: '0xTRUX...511c',
      ),
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
