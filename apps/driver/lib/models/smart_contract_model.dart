class SmartContract {
  final String contractAddress;
  final String loadId;
  final double escrowAmount;
  final bool isGeofenceConfirmed;
  final bool isPodUploaded;
  final String status; // e.g., 'ESCROW_FUNDED', 'RELEASED'

  SmartContract({
    required this.contractAddress,
    required this.loadId,
    required this.escrowAmount,
    this.isGeofenceConfirmed = false,
    this.isPodUploaded = false,
    required this.status,
  });
}
