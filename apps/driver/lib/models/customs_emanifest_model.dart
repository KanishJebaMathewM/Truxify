class CustomsEmanifest {
  final String manifestId;
  final String loadReference;
  final String borderAgency; // 'CBP' (US) or 'CBSA' (Canada)
  final String portOfEntry;
  final String barcodeData;
  final String approvalStatus; // 'PENDING', 'APPROVED', 'REJECTED'
  final DateTime submissionTime;

  CustomsEmanifest({
    required this.manifestId,
    required this.loadReference,
    required this.borderAgency,
    required this.portOfEntry,
    required this.barcodeData,
    required this.approvalStatus,
    required this.submissionTime,
  });
}
