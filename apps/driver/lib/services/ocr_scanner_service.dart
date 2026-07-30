import 'dart:math';
import '../models/pod_document_model.dart';

class OcrScannerService {
  /// Simulates scanning an image file using an OCR engine (like Google ML Kit)
  /// and extracting key Bill of Lading (BoL) data.
  Future<PodDocument> scanDocument(String imagePath) async {
    // Simulate processing delay for OCR engine
    await Future.delayed(const Duration(seconds: 3));

    final randomId = Random().nextInt(10000).toString().padLeft(4, '0');
    
    // Simulated extracted text block
    const mockExtractedText = '''
    BILL OF LADING
    Load Ref: TRK-992-AZ
    Receiver: Acme Warehouse Corp
    Date: 2026-07-27
    Signature: [VERIFIED]
    ''';

    return PodDocument(
      documentId: 'DOC-$randomId',
      loadReferenceNumber: 'TRK-992-AZ',
      receiverName: 'Acme Warehouse Corp',
      scanTimestamp: DateTime.now(),
      hasSignature: true,
      rawExtractedText: mockExtractedText,
    );
  }

  /// Submits the processed digital PoD to the blockchain ledger for immutable storage
  Future<bool> submitDigitalPoD(PodDocument document) async {
    // Simulate network upload
    await Future.delayed(const Duration(seconds: 1));
    return true; // Success
  }
}
