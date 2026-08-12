import 'dart:io';

import '../models/pod_document_model.dart';

class OcrScannerService {
  /// Scans an image file and extracts key Bill of Lading data.
  Future<PodDocument> scanDocument(String imagePath) async {
    final file = File(imagePath);
    if (!await file.exists()) {
      throw ArgumentError.value(
        imagePath,
        'imagePath',
        'Document image does not exist.',
      );
    }

    throw UnsupportedError(
      'OCR scanning is not configured. Connect an OCR provider before accepting scanned PoD data.',
    );
  }

  /// Submits the processed digital PoD to the blockchain ledger for immutable storage
  Future<bool> submitDigitalPoD(PodDocument document) async {
    throw UnsupportedError(
      'Digital PoD submission is not configured. Connect the backend or ledger submission endpoint before reporting success.',
    );
  }
}
