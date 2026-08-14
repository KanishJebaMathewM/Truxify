class ExtractedField {
  final String label; // "Shipper Name", "Total Weight"
  final String value; // "Acme Farms", "42,000 lbs"
  final double confidence; // 0.0 to 1.0

  ExtractedField({
    required this.label,
    required this.value,
    required this.confidence,
  });
}

class OcrDocumentSession {
  final String status; // "Processing locally...", "Queued for Sync"
  final bool isNetworkAvailable;
  final bool isProcessingComplete;
  final String documentType; // "Bill of Lading"
  final List<ExtractedField> extractedFields;

  OcrDocumentSession({
    required this.status,
    required this.isNetworkAvailable,
    required this.isProcessingComplete,
    required this.documentType,
    required this.extractedFields,
  });
}
