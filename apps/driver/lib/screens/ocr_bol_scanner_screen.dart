import 'package:flutter/material.dart';
import '../models/ocr_bol_model.dart';
import '../services/ocr_bol_service.dart';

class OcrBolScannerScreen extends StatefulWidget {
  const OcrBolScannerScreen({super.key});

  @override
  State<OcrBolScannerScreen> createState() => _OcrBolScannerScreenState();
}

class _OcrBolScannerScreenState extends State<OcrBolScannerScreen> {
  final OcrBolService _ocrService = OcrBolService();
  bool _isScanning = false;
  OcrBolData? _extractedData;

  void _startScan() async {
    setState(() {
      _isScanning = true;
      _extractedData = null;
    });

    final data = await _ocrService.scanAndExtractData();

    if (mounted) {
      setState(() {
        _isScanning = false;
        _extractedData = data;
      });
    }
  }

  void _submitData() {
    if (_extractedData == null) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('BOL Data successfully verified and submitted!'),
        backgroundColor: Colors.green,
      )
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('BOL Smart Scanner'),
        backgroundColor: Colors.deepPurple[900],
      ),
      backgroundColor: Colors.grey[200],
      body: Column(
        children: [
          _buildCameraView(),
          Expanded(
            child: Container(
              padding: const EdgeInsets.all(24),
              width: double.infinity,
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.only(topLeft: Radius.circular(24), topRight: Radius.circular(24)),
              ),
              child: _isScanning
                  ? _buildScanningIndicator()
                  : _extractedData != null
                      ? _buildExtractedDataView()
                      : _buildInitialInstructions(),
            ),
          )
        ],
      ),
    );
  }

  Widget _buildCameraView() {
    return Container(
      height: 300,
      width: double.infinity,
      color: Colors.black,
      child: Stack(
        alignment: Alignment.center,
        children: [
          const Icon(Icons.document_scanner, size: 100, color: Colors.white24),
          Container(
            width: 250,
            height: 200,
            decoration: BoxDecoration(
              border: Border.all(color: _isScanning ? Colors.deepPurple : Colors.white54, width: 2),
              borderRadius: BorderRadius.circular(12),
            ),
          ),
          if (!_isScanning && _extractedData == null)
            Positioned(
              bottom: 20,
              child: ElevatedButton.icon(
                onPressed: _startScan,
                icon: const Icon(Icons.camera_alt),
                label: const Text('CAPTURE BOL'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.deepPurple[900],
                  foregroundColor: Colors.white,
                ),
              ),
            )
        ],
      ),
    );
  }

  Widget _buildScanningIndicator() {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        CircularProgressIndicator(color: Colors.deepPurple[900]),
        const SizedBox(height: 24),
        const Text('Extracting text and signatures via OCR...', style: TextStyle(fontSize: 16, color: Colors.grey)),
      ],
    );
  }

  Widget _buildInitialInstructions() {
    return const Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(Icons.crop_free, size: 64, color: Colors.grey),
        SizedBox(height: 16),
        Text('Align paper BOL within the frame.', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        SizedBox(height: 8),
        Text('Ensure good lighting to maximize AI extraction accuracy.', textAlign: TextAlign.center, style: TextStyle(color: Colors.grey)),
      ],
    );
  }

  Widget _buildExtractedDataView() {
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Extracted Data', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                decoration: BoxDecoration(color: Colors.green[50], borderRadius: BorderRadius.circular(12)),
                child: Text('CONFIDENCE: ${(_extractedData!.confidenceScore * 100).toInt()}%', style: TextStyle(color: Colors.green[900], fontWeight: FontWeight.bold, fontSize: 12)),
              )
            ],
          ),
          const SizedBox(height: 16),
          _buildDataField('BOL Number', _extractedData!.bolNumber),
          _buildDataField('Shipper', _extractedData!.shipperName),
          _buildDataField('Receiver', _extractedData!.receiverName),
          Row(
            children: [
              Expanded(child: _buildDataField('Total Weight', '${_extractedData!.totalWeightLbs} lbs')),
              Expanded(child: _buildDataField('Piece Count', '${_extractedData!.pieceCount} pallets')),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Icon(_extractedData!.signatureDetected ? Icons.check_circle : Icons.error, color: _extractedData!.signatureDetected ? Colors.green : Colors.red),
              const SizedBox(width: 8),
              Text(_extractedData!.signatureDetected ? 'Receiver Signature Verified' : 'Missing Signature', style: const TextStyle(fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            height: 50,
            child: ElevatedButton.icon(
              onPressed: _submitData,
              icon: const Icon(Icons.cloud_upload),
              label: const Text('VERIFY & SUBMIT POD'),
              style: ElevatedButton.styleFrom(backgroundColor: Colors.deepPurple[900], foregroundColor: Colors.white),
            ),
          )
        ],
      ),
    );
  }

  Widget _buildDataField(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
          const SizedBox(height: 4),
          Text(value, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}
