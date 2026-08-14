class BlockchainTransaction {
  final String txHash;
  final String blockNumber;
  final String timestamp;
  final String receiverSignatureData;
  final String gpsCoordinates;
  final String smartContractAddress;

  BlockchainTransaction({
    required this.txHash,
    required this.blockNumber,
    required this.timestamp,
    required this.receiverSignatureData,
    required this.gpsCoordinates,
    required this.smartContractAddress,
  });
}

class BlockchainBolSession {
  final String status;
  final String loadId;
  final bool isHashing;
  final bool isMinting;
  final BlockchainTransaction? finalizedTransaction;

  BlockchainBolSession({
    required this.status,
    required this.loadId,
    required this.isHashing,
    required this.isMinting,
    this.finalizedTransaction,
  });
}
