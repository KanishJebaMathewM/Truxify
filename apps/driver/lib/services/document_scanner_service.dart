import 'dart:async';
import '../models/document_scanner_model.dart';

class DocumentScannerService {
  final _sessionController = StreamController<DocumentScanState>.broadcast();
  
  Stream<DocumentScanState> get scannerStream => _sessionController.stream;

  void initializeDashboard() {
    _emitState('Awaiting Camera Input', false, false, false, false);
  }

  void processDocumentImage() async {
    _emitState('Running Canny Edge Detection...', true, false, false, false);

    await Future.delayed(const Duration(seconds: 1));
    
    _emitState('Applying Perspective Matrix Warp...', false, true, false, false);

    await Future.delayed(const Duration(seconds: 1));
    
    _emitState('Applying High-Contrast B&W Filter...', false, false, true, false);
    
    await Future.delayed(const Duration(seconds: 1));

    _emitState('Document Ready for Accounting', false, false, false, true);
  }

  void _emitState(String status, bool edge, bool warp, bool filter, bool complete) {
    _sessionController.add(DocumentScanState(
      status: status,
      isDetectingEdges: edge,
      isWarpingPerspective: warp,
      isApplyingFilter: filter,
      isProcessingComplete: complete,
      rawImagePath: 'assets/mock/skewed_dark_bol.jpg', // Mock path
      processedImagePath: 'assets/mock/perfect_scanned_bol.pdf', // Mock path
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
