class CustomsDocument {
  final String documentType; // "e-Manifest", "Commercial Invoice", "Driver Passport"
  final String documentId;
  final String status; // "Verified", "Pending", "Rejected"

  CustomsDocument({
    required this.documentType,
    required this.documentId,
    required this.status,
  });
}

class CustomsClearanceSession {
  final String borderCrossing; // "Laredo World Trade Bridge", "Ambassador Bridge Detroit"
  final String status; // "Transmitting API Data", "CBP ACE Pre-Cleared"
  final List<CustomsDocument> documents;
  final bool isCleared;
  final String? fastLaneBarcode;

  CustomsClearanceSession({
    required this.borderCrossing,
    required this.status,
    required this.documents,
    required this.isCleared,
    this.fastLaneBarcode,
  });
}
