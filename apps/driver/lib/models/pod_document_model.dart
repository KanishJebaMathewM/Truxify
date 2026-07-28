class PodDocument {
  final String documentId;
  final String loadReferenceNumber;
  final String receiverName;
  final DateTime scanTimestamp;
  final bool hasSignature;
  final String rawExtractedText;

  PodDocument({
    required this.documentId,
    required this.loadReferenceNumber,
    required this.receiverName,
    required this.scanTimestamp,
    this.hasSignature = false,
    required this.rawExtractedText,
  });

  Map<String, dynamic> toJson() {
    return {
      'documentId': documentId,
      'loadReferenceNumber': loadReferenceNumber,
      'receiverName': receiverName,
      'scanTimestamp': scanTimestamp.toIso8601String(),
      'hasSignature': hasSignature,
      'rawExtractedText': rawExtractedText,
    };
  }
}
