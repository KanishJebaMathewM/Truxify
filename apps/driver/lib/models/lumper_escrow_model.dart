class LumperEscrowContract {
  final String contractAddress;
  final String loadId;
  final String brokerName;
  final String facilityName;
  final double escrowedAmount;
  final String status; // 'Locked', 'Pending OCR Verification', 'Released', 'Disputed'

  LumperEscrowContract({
    required this.contractAddress,
    required this.loadId,
    required this.brokerName,
    required this.facilityName,
    required this.escrowedAmount,
    required this.status,
  });
}
