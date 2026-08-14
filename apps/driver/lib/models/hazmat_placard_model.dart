class HazmatRequirements {
  final String unNumber;
  final String properShippingName;
  final String requiredPlacardClass; // e.g. 'Class 3 Flammable Liquid'
  final String hazardColor;

  HazmatRequirements({
    required this.unNumber,
    required this.properShippingName,
    required this.requiredPlacardClass,
    required this.hazardColor,
  });
}

class PlacardScanResult {
  final String detectedClass;
  final String detectedUnNumber;
  final double confidenceScore;
  final bool isCompliant;
  final String feedbackMessage;

  PlacardScanResult({
    required this.detectedClass,
    required this.detectedUnNumber,
    required this.confidenceScore,
    required this.isCompliant,
    required this.feedbackMessage,
  });
}
