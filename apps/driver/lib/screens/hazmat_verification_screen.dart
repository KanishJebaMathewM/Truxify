import 'package:flutter/material.dart';
import '../models/hazmat_placard_model.dart';
import '../services/hazmat_vision_service.dart';

class HazmatVerificationScreen extends StatefulWidget {
  const HazmatVerificationScreen({super.key});

  @override
  State<HazmatVerificationScreen> createState() => _HazmatVerificationScreenState();
}

class _HazmatVerificationScreenState extends State<HazmatVerificationScreen> {
  final HazmatVisionService _service = HazmatVisionService();
  HazmatRequirements? _requirements;
  PlacardScanResult? _scanResult;
  bool _isLoadingRequirements = true;
  bool _isScanningImage = false;

  @override
  void initState() {
    super.initState();
    _loadRequirements();
  }

  void _loadRequirements() async {
    final reqs = await _service.getRequiredPlacards('BOL-9921-HZ');
    if (mounted) {
      setState(() {
        _requirements = reqs;
        _isLoadingRequirements = false;
      });
    }
  }

  void _captureAndAnalyzeImage() async {
    setState(() {
      _isScanningImage = true;
      _scanResult = null;
    });

    final result = await _service.analyzeTrailerImage('mock_trailer_photo.jpg');

    if (mounted) {
      setState(() {
        _scanResult = result;
        _isScanningImage = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Hazmat Vision Verification'),
        backgroundColor: Colors.red[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoadingRequirements
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  _buildBolRequirementsCard(),
                  const SizedBox(height: 24),
                  if (_scanResult != null) _buildScanResultCard(),
                  const SizedBox(height: 24),
                  _buildScannerControls(),
                ],
              ),
            ),
    );
  }

  Widget _buildBolRequirementsCard() {
    final r = _requirements!;
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.description, color: Colors.red[900]),
                const SizedBox(width: 8),
                const Text('Bill of Lading Requirements', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              ],
            ),
            const Divider(height: 32),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 80, height: 80,
                  decoration: BoxDecoration(color: Colors.red, borderRadius: BorderRadius.circular(8), border: Border.all(color: Colors.white, width: 3)),
                  child: Center(
                    child: Transform.rotate(
                      angle: 0.785398, // 45 degrees for diamond shape
                      child: Container(width: 50, height: 50, decoration: BoxDecoration(border: Border.all(color: Colors.white, width: 2))),
                    ),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('UN ${r.unNumber}', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
                      Text(r.properShippingName, style: TextStyle(color: Colors.grey[700], fontSize: 16)),
                      const SizedBox(height: 8),
                      Text('Required Placard: ${r.requiredPlacardClass}', style: TextStyle(color: Colors.red[900], fontWeight: FontWeight.bold)),
                    ],
                  ),
                )
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildScanResultCard() {
    final s = _scanResult!;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: s.isCompliant ? Colors.green[50] : Colors.red[50],
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: s.isCompliant ? Colors.green : Colors.red, width: 2)
      ),
      child: Column(
        children: [
          Icon(s.isCompliant ? Icons.check_circle : Icons.warning, size: 64, color: s.isCompliant ? Colors.green : Colors.red),
          const SizedBox(height: 16),
          Text(s.isCompliant ? 'PLACARD VERIFIED' : 'COMPLIANCE VIOLATION', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: s.isCompliant ? Colors.green[800] : Colors.red[800])),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(12),
            color: Colors.white,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Detected UN: ${s.detectedUnNumber}', style: const TextStyle(fontWeight: FontWeight.bold)),
                Text('Detected Class: ${s.detectedClass}'),
                Text('Confidence: ${(s.confidenceScore * 100).toStringAsFixed(1)}%', style: const TextStyle(color: Colors.grey, fontSize: 12)),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Text(s.feedbackMessage, textAlign: TextAlign.center, style: TextStyle(color: s.isCompliant ? Colors.green[800] : Colors.red[900], fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildScannerControls() {
    if (_isScanningImage) {
      return Container(
        padding: const EdgeInsets.all(32),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
        child: Column(
          children: [
            const CircularProgressIndicator(color: Colors.red),
            const SizedBox(height: 24),
            Text('Analyzing Trailer Placards...', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.red[900])),
            const Text('Running computer vision models', style: TextStyle(color: Colors.grey)),
          ],
        ),
      );
    }

    return SizedBox(
      width: double.infinity,
      height: 56,
      child: ElevatedButton.icon(
        onPressed: _captureAndAnalyzeImage,
        icon: const Icon(Icons.camera_alt),
        label: const Text('SCAN TRAILER PLACARDS', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
        style: ElevatedButton.styleFrom(backgroundColor: Colors.black, foregroundColor: Colors.white),
      ),
    );
  }
}
