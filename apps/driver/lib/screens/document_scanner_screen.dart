import 'package:flutter/material.dart';
import '../models/document_scanner_model.dart';
import '../services/document_scanner_service.dart';

class DocumentScannerScreen extends StatefulWidget {
  const DocumentScannerScreen({super.key});

  @override
  State<DocumentScannerScreen> createState() => _DocumentScannerScreenState();
}

class _DocumentScannerScreenState extends State<DocumentScannerScreen> {
  final DocumentScannerService _service = DocumentScannerService();
  DocumentScanState? _session;

  @override
  void initState() {
    super.initState();
    _service.scannerStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.initializeDashboard();
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
        title: const Text('Computer Vision Scanner'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _session?.isProcessingComplete == true ? null : () => _service.processDocumentImage(),
        backgroundColor: Colors.indigo,
        icon: const Icon(Icons.camera_alt),
        label: const Text('Capture & Process BOL'),
      ),
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
              const Text('LIVE PROCESSING PIPELINE', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildPipelineStep('1. Edge Detection (OpenCV)', s.isDetectingEdges, s.isWarpingPerspective || s.isApplyingFilter || s.isProcessingComplete),
              _buildPipelineStep('2. Perspective Warp (Flatten)', s.isWarpingPerspective, s.isApplyingFilter || s.isProcessingComplete),
              _buildPipelineStep('3. High-Contrast B&W Filter', s.isApplyingFilter, s.isProcessingComplete),
              const SizedBox(height: 24),
              _buildVisualComparisonCard(s),
              const SizedBox(height: 80), // Padding for FAB
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(DocumentScanState s) {
    bool isProcessing = s.isDetectingEdges || s.isWarpingPerspective || s.isApplyingFilter;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: isProcessing ? Colors.indigo[600] : (s.isProcessingComplete ? Colors.green[700] : Colors.blueGrey[800]),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              isProcessing 
                ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3))
                : Icon(s.isProcessingComplete ? Icons.check_circle : Icons.document_scanner, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('CLIENT-SIDE VISION ENGINE', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildPipelineStep(String label, bool isActive, bool isComplete) {
    Color iconColor = isComplete ? Colors.green : (isActive ? Colors.indigo : Colors.grey);
    IconData icon = isComplete ? Icons.check_circle : (isActive ? Icons.sync : Icons.radio_button_unchecked);

    return Card(
      elevation: isActive ? 4 : 1,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(color: isActive ? Colors.indigo : Colors.transparent, width: 2),
      ),
      child: ListTile(
        leading: Icon(icon, color: iconColor),
        title: Text(label, style: TextStyle(fontWeight: isActive || isComplete ? FontWeight.bold : FontWeight.normal)),
        trailing: isActive ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : null,
      ),
    );
  }

  Widget _buildVisualComparisonCard(DocumentScanState s) {
    if (!s.isProcessingComplete && !s.isWarpingPerspective && !s.isApplyingFilter && !s.isDetectingEdges) {
      return const SizedBox.shrink(); // Hide until started
    }

    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            const Row(
              children: [
                Icon(Icons.compare, color: Colors.indigo),
                SizedBox(width: 12),
                Text('Render Output', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                _buildMockImageContainer('Raw Camera Image', Icons.image_not_supported, Colors.grey[300]!, true),
                const Icon(Icons.arrow_forward, color: Colors.indigo, size: 32),
                _buildMockImageContainer(
                  'Processed PDF', 
                  s.isProcessingComplete ? Icons.picture_as_pdf : Icons.blur_on, 
                  s.isProcessingComplete ? Colors.white : Colors.indigo[50]!, 
                  !s.isProcessingComplete,
                ),
              ],
            ),
            if (s.isProcessingComplete) ...[
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: () {},
                  icon: const Icon(Icons.cloud_upload),
                  label: const Text('Upload Flawless PDF to Accounting'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.green,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.all(16),
                  ),
                ),
              )
            ]
          ],
        ),
      ),
    );
  }

  Widget _buildMockImageContainer(String label, IconData icon, Color bgColor, bool isSkewed) {
    return Column(
      children: [
        Transform(
          transform: isSkewed ? (Matrix4.identity()..setEntry(3, 2, 0.002)..rotateX(-0.3)..rotateY(0.2)) : Matrix4.identity(),
          alignment: FractionalOffset.center,
          child: Container(
            width: 100,
            height: 140,
            decoration: BoxDecoration(
              color: bgColor,
              border: Border.all(color: Colors.grey),
              boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 5)],
            ),
            child: Center(child: Icon(icon, size: 48, color: isSkewed ? Colors.grey[500] : Colors.red[700])),
          ),
        ),
        const SizedBox(height: 12),
        Text(label, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
      ],
    );
  }
}
