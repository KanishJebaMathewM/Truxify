import 'dart:async';
import '../models/ocr_bol_model.dart';

class OcrBolService {
  /// Simulates processing an image of a BOL through an OCR engine
  Future<OcrBolData> scanAndExtractData() async {
    await Future.delayed(const Duration(seconds: 3));

    return OcrBolData(
      bolNumber: 'BOL-55928-11',
      shipperName: 'Acme Manufacturing Corp',
      receiverName: 'Global Distribution Center',
      totalWeightLbs: 42500,
      pieceCount: 24,
      signatureDetected: true,
      confidenceScore: 0.98,
    );
  }
}
