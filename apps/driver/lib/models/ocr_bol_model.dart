class OcrBolData {
  final String bolNumber;
  final String shipperName;
  final String receiverName;
  final int totalWeightLbs;
  final int pieceCount;
  final bool signatureDetected;
  final double confidenceScore; // 0.0 to 1.0

  OcrBolData({
    required this.bolNumber,
    required this.shipperName,
    required this.receiverName,
    required this.totalWeightLbs,
    required this.pieceCount,
    required this.signatureDetected,
    required this.confidenceScore,
  });
}
