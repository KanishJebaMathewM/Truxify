import 'dart:async';
import 'dart:math';
import 'package:crypto/crypto.dart';
import 'dart:convert';
import '../models/blockchain_bol_model.dart';

class BlockchainBolService {
  final _sessionController = StreamController<BlockchainBolSession>.broadcast();
  
  Stream<BlockchainBolSession> get bolStream => _sessionController.stream;

  void initializeScanner(String loadId) {
    _emitState('Awaiting Receiver Signature', loadId, false, false, null);
  }

  void signAndMintBol(String loadId, String signatureName) async {
    _emitState('Cryptographically Hashing Signature & GPS...', loadId, true, false, null);

    await Future.delayed(const Duration(seconds: 1));
    
    _emitState('Minting Immutable Record to Ledger...', loadId, false, true, null);

    await Future.delayed(const Duration(seconds: 2));

    String timestamp = DateTime.now().toIso8601String();
    String gps = '34.0522° N, 118.2437° W (Los Angeles, CA)';
    
    // Generate a mock SHA-256 hash simulating a blockchain TX
    var bytes = utf8.encode(signatureName + timestamp + gps);
    var digest = sha256.convert(bytes);
    
    String mockTxHash = '0x${digest.toString()}';
    String mockBlock = (Random().nextInt(50000) + 15000000).toString();

    BlockchainTransaction tx = BlockchainTransaction(
      txHash: mockTxHash,
      blockNumber: mockBlock,
      timestamp: timestamp,
      receiverSignatureData: signatureName,
      gpsCoordinates: gps,
      smartContractAddress: '0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7',
    );

    _emitState('BOL Cryptographically Secured', loadId, false, false, tx);
  }

  void _emitState(String status, String loadId, bool isHashing, bool isMinting, BlockchainTransaction? tx) {
    _sessionController.add(BlockchainBolSession(
      status: status,
      loadId: loadId,
      isHashing: isHashing,
      isMinting: isMinting,
      finalizedTransaction: tx,
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
