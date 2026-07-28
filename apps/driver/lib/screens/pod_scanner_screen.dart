import 'package:flutter/material.dart';
import '../models/pod_document_model.dart';
import '../services/ocr_scanner_service.dart';

class PodScannerScreen extends StatefulWidget {
  const PodScannerScreen({super.key});

  @override
  State<PodScannerScreen> createState() => _PodScannerScreenState();
}

class _PodScannerScreenState extends State<PodScannerScreen> {
  final OcrScannerService _ocrService = OcrScannerService();
  bool _isScanning = false;
  PodDocument? _scannedDocument;

  Future<void> _simulateCameraScan() async {
    setState(() {
      _isScanning = true;
      _scannedDocument = null;
    });

    // Simulated image path from camera
    final doc = await _ocrService.scanDocument('/local/cache/image_capture.jpg');

    setState(() {
      _isScanning = false;
      _scannedDocument = doc;
    });
  }

  Future<void> _submitDocument() async {
    if (_scannedDocument == null) return;
    
    final success = await _ocrService.submitDigitalPoD(_scannedDocument!);
    if (success && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Digital PoD Submitted Successfully! Invoice triggered.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Automated PoD Scanner'),
        backgroundColor: Colors.teal[800],
      ),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              height: 250,
              decoration: BoxDecoration(
                color: Colors.grey[200],
                border: Border.all(color: Colors.grey, width: 2),
                borderRadius: BorderRadius.circular(12),
              ),
              child: _isScanning 
                ? const Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      CircularProgressIndicator(),
                      SizedBox(height: 16),
                      Text('Running OCR Analysis...', style: TextStyle(fontWeight: FontWeight.bold))
                    ],
                  )
                : Center(
                    child: Icon(Icons.document_scanner, size: 80, color: Colors.grey[400]),
                  ),
            ),
            const SizedBox(height: 20),
            ElevatedButton.icon(
              onPressed: _isScanning ? null : _simulateCameraScan,
              icon: const Icon(Icons.camera_alt),
              label: const Text('Scan Bill of Lading'),
              style: ElevatedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 16),
                backgroundColor: Colors.teal,
                foregroundColor: Colors.white,
              ),
            ),
            const SizedBox(height: 24),
            if (_scannedDocument != null) ...[
              const Text('Extracted Data:', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
              const SizedBox(height: 10),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _buildDataRow('Load Ref:', _scannedDocument!.loadReferenceNumber),
                      _buildDataRow('Receiver:', _scannedDocument!.receiverName),
                      _buildDataRow('Signature:', _scannedDocument!.hasSignature ? 'Verified' : 'Missing'),
                    ],
                  ),
                ),
              ),
              const Spacer(),
              ElevatedButton(
                onPressed: _submitDocument,
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  backgroundColor: Colors.blue[800],
                  foregroundColor: Colors.white,
                ),
                child: const Text('Submit & Trigger Invoice', style: TextStyle(fontSize: 16)),
              )
            ]
          ],
        ),
      ),
    );
  }

  Widget _buildDataRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: Colors.grey)),
          Text(value, style: const TextStyle(fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }
}
