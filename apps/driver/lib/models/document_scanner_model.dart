class DocumentScanState {
  final String status;
  final bool isDetectingEdges;
  final bool isWarpingPerspective;
  final bool isApplyingFilter;
  final bool isProcessingComplete;
  
  // Mocking the visual representation of the steps
  final String rawImagePath;
  final String processedImagePath;

  DocumentScanState({
    required this.status,
    required this.isDetectingEdges,
    required this.isWarpingPerspective,
    required this.isApplyingFilter,
    required this.isProcessingComplete,
    required this.rawImagePath,
    required this.processedImagePath,
  });
}
