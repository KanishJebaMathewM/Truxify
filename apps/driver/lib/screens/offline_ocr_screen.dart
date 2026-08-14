import 'package:flutter/material.dart';
import '../models/offline_ocr_model.dart';
import '../services/offline_ocr_service.dart';

class OfflineOcrScreen extends StatefulWidget {
  const OfflineOcrScreen({super.key});

  @override
  State<OfflineOcrScreen> createState() => _OfflineOcrScreenState();
}

class _OfflineOcrScreenState extends State<OfflineOcrScreen> {
  final OfflineOcrService _service = OfflineOcrService();
  OcrDocumentSession? _session;

  @override
  void initState() {
    super.initState();
    _service.ocrStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateOfflineScanning();
  }

  @override
  void dispose() {
    _service.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Offline Document Scanner'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final s = _session!;

    return Column(
      children: [
        _buildStatusHeader(s),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (s.isProcessingComplete) ...[
                const Text('EXTRACTED DATA (LOCAL DB)', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                const SizedBox(height: 12),
                _buildExtractedDataCard(s),
              ] else ...[
                const SizedBox(height: 48),
                const Center(
                  child: Column(
                    children: [
                      CircularProgressIndicator(color: Colors.blueGrey),
                      SizedBox(height: 24),
                      Text('Running Local ML Model...', style: TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold)),
                    ],
                  ),
                )
              ]
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(OcrDocumentSession s) {
    Color headerColor;
    IconData icon;
    
    if (s.isNetworkAvailable) {
      headerColor = Colors.green[800]!;
      icon = Icons.cloud_done;
    } else if (s.isProcessingComplete) {
      headerColor = Colors.orange[800]!;
      icon = Icons.cloud_off;
    } else {
      headerColor = Colors.blueGrey[800]!;
      icon = Icons.document_scanner;
    }

    return AnimatedContainer(
      duration: const Duration(milliseconds: 500),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: headerColor,
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('ON-DEVICE NEURAL OCR', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
          if (!s.isProcessingComplete) ...[
            const SizedBox(height: 16),
            const LinearProgressIndicator(color: Colors.white, backgroundColor: Colors.white24),
          ]
        ],
      ),
    );
  }

  Widget _buildExtractedDataCard(OcrDocumentSession s) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    const Icon(Icons.receipt_long, color: Colors.blueGrey),
                    const SizedBox(width: 12),
                    Text(s.documentType, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                  ],
                ),
                if (!s.isNetworkAvailable)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(color: Colors.orange[50], borderRadius: BorderRadius.circular(20), border: Border.all(color: Colors.orange[300]!)),
                    child: const Text('QUEUED', style: TextStyle(color: Colors.orange, fontWeight: FontWeight.bold, fontSize: 10)),
                  )
                else
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(color: Colors.green[50], borderRadius: BorderRadius.circular(20), border: Border.all(color: Colors.green[300]!)),
                    child: const Text('SYNCED', style: TextStyle(color: Colors.green, fontWeight: FontWeight.bold, fontSize: 10)),
                  )
              ],
            ),
            const Divider(height: 32),
            ...s.extractedFields.map((field) => _buildFieldRow(field)),
          ],
        ),
      ),
    );
  }

  Widget _buildFieldRow(ExtractedField field) {
    bool isLowConfidence = field.confidence < 0.8;

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(field.label, style: const TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold)),
              const SizedBox(height: 4),
              Text(field.value, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.black87)),
            ],
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text('${(field.confidence * 100).toInt()}%', style: TextStyle(color: isLowConfidence ? Colors.orange : Colors.green, fontWeight: FontWeight.bold)),
              if (isLowConfidence)
                const Text('Review Suggested', style: TextStyle(color: Colors.orange, fontSize: 10)),
            ],
          )
        ],
      ),
    );
  }
}
