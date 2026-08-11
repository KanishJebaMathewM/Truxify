class FreightSmartContract {
  final String contractId;
  final String loadId;
  final String brokerName;
  final double payoutAmount;
  final String status; // 'ESCROW_FUNDED', 'POD_UPLOADED', 'GEOFENCE_BREACHED', 'RELEASED', 'SETTLED'
  final String walletAddress;
  final bool isGeofenceConfirmed;
  final bool isPodUploaded;
  final DateTime createdAt;
  final DateTime? settledAt;

  FreightSmartContract({
    required this.contractId,
    required this.loadId,
    required this.brokerName,
    required this.payoutAmount,
    required this.status,
    required this.walletAddress,
    this.isGeofenceConfirmed = false,
    this.isPodUploaded = false,
    required this.createdAt,
    this.settledAt,
  });
}
