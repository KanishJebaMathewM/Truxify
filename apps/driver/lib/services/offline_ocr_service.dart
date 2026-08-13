import 'dart:async';
import '../models/offline_ocr_model.dart';

class OfflineOcrService {
  final _sessionController = StreamController<OcrDocumentSession>.broadcast();

  Stream<OcrDocumentSession> get ocrStream => _sessionController.stream;

  void simulateOfflineScanning() async {
    // 1. Start scanning, no network
    _sessionController.add(OcrDocumentSession(
      status: 'No Network. Running local OCR model...',
      isNetworkAvailable: false,
      isProcessingComplete: false,
      documentType: 'Unknown',
      extractedFields: [],
    ));

    await Future.delayed(const Duration(seconds: 3));

    // 2. Processing complete, queued
    _sessionController.add(OcrDocumentSession(
      status: 'OCR Complete. Queued for background sync.',
      isNetworkAvailable: false,
      isProcessingComplete: true,
      documentType: 'Bill of Lading (BOL)',
      extractedFields: [
        ExtractedField(label: 'Shipper', value: 'Acme Corn Farms', confidence: 0.98),
        ExtractedField(label: 'Destination', value: 'Chicago Processing Plant', confidence: 0.95),
        ExtractedField(label: 'Total Weight', value: '42,500 lbs', confidence: 0.89),
        ExtractedField(label: 'PO Number', value: 'PO-8849201', confidence: 0.76),
      ],
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Network restored, synced
    _sessionController.add(OcrDocumentSession(
      status: 'Network Restored. Document Synced to Cloud.',
      isNetworkAvailable: true,
      isProcessingComplete: true,
      documentType: 'Bill of Lading (BOL)',
      extractedFields: [
        ExtractedField(label: 'Shipper', value: 'Acme Corn Farms', confidence: 0.98),
        ExtractedField(label: 'Destination', value: 'Chicago Processing Plant', confidence: 0.95),
        ExtractedField(label: 'Total Weight', value: '42,500 lbs', confidence: 0.89),
        ExtractedField(label: 'PO Number', value: 'PO-8849201', confidence: 0.76),
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
