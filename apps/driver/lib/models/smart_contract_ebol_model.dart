class BlockchainTransaction {
  final String transactionHash;
  final String timestamp;
  final String status; // "Pending Signatures", "Executing Contract", "Funds Released"
  final double loadPayoutUsd;
  final String receiverWalletAddress;
  final String carrierWalletAddress;

  BlockchainTransaction({
    required this.transactionHash,
    required this.timestamp,
    required this.status,
    required this.loadPayoutUsd,
    required this.receiverWalletAddress,
    required this.carrierWalletAddress,
  });
}

class EbolSession {
  final String loadId;
  final String receiverName;
  final bool isGeofenceVerified;
  final bool isReceiverSigned;
  final BlockchainTransaction? transaction;
  
  EbolSession({
    required this.loadId,
    required this.receiverName,
    required this.isGeofenceVerified,
    required this.isReceiverSigned,
    this.transaction,
  });
}
