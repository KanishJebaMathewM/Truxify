import 'package:flutter/material.dart';
import '../models/trailer_seal_integrity_model.dart';
import '../services/trailer_seal_integrity_service.dart';

class TrailerSealIntegrityScreen extends StatefulWidget {
  const TrailerSealIntegrityScreen({super.key});

  @override
  State<TrailerSealIntegrityScreen> createState() => _TrailerSealIntegrityScreenState();
}

class _TrailerSealIntegrityScreenState extends State<TrailerSealIntegrityScreen> {
  final TrailerSealIntegrityService _service = TrailerSealIntegrityService();
  String? _expectedSerial;
  SealIntegrityScan? _scanResult;
  bool _isScanning = false;
  bool _isLoadingBol = true;

  @override
  void initState() {
    super.initState();
    _loadBolData();
  }

  void _loadBolData() async {
    final serial = await _service.getExpectedSealNumber('BOL-992-FX');
    if (mounted) {
      setState(() {
        _expectedSerial = serial;
        _isLoadingBol = false;
      });
    }
  }

  void _captureAndAnalyze() async {
    if (_expectedSerial == null) return;

    setState(() {
      _isScanning = true;
      _scanResult = null;
    });

    final result = await _service.analyzeSealImage('temp/macro_photo.jpg', _expectedSerial!);

    if (mounted) {
      setState(() {
        _scanResult = result;
        _isScanning = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Seal Integrity Checker'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoadingBol
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                _buildExpectedHeader(),
                Expanded(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      children: [
                        if (_isScanning) _buildScanningState(),
                        if (!_isScanning && _scanResult == null) _buildCameraPrompt(),
                        if (_scanResult != null) _buildScanResultCard(),
                      ],
                    ),
                  ),
                ),
                _buildScannerButton(),
              ],
            ),
    );
  }

  Widget _buildExpectedHeader() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: Colors.white,
      child: Column(
        children: [
          const Text('Bill of Lading Expected Seal', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Text(_expectedSerial ?? 'Loading...', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold, letterSpacing: 2.0)),
        ],
      ),
    );
  }

  Widget _buildCameraPrompt() {
    return Container(
      width: double.infinity,
      height: 250,
      decoration: BoxDecoration(
        color: Colors.grey[300],
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.grey[400]!, width: 2, style: BorderStyle.solid),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.camera_alt, size: 64, color: Colors.grey[500]),
          const SizedBox(height: 16),
          Text('Take a macro photo of the bolt seal', style: TextStyle(color: Colors.grey[700])),
        ],
      ),
    );
  }

  Widget _buildScanningState() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 48),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
      child: Column(
        children: [
          const CircularProgressIndicator(color: Colors.blueGrey),
          const SizedBox(height: 24),
          Text('Analyzing Seal Integrity...', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.blueGrey[900])),
          const Text('Running computer vision checks and generating hash.', style: TextStyle(color: Colors.grey)),
        ],
      ),
    );
  }

  Widget _buildScanResultCard() {
    final s = _scanResult!;
    final isSuccess = s.isSerialMatch && !s.isTamperingDetected;

    return Card(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: isSuccess ? Colors.green : Colors.red, width: 2),
      ),
      elevation: 4,
      child: Column(
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: isSuccess ? Colors.green[50] : Colors.red[50],
              borderRadius: const BorderRadius.only(topLeft: Radius.circular(14), topRight: Radius.circular(14)),
            ),
            child: Column(
              children: [
                Icon(isSuccess ? Icons.verified : Icons.gpp_bad, size: 48, color: isSuccess ? Colors.green : Colors.red),
                const SizedBox(height: 12),
                Text(s.scanStatus, style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: isSuccess ? Colors.green[800] : Colors.red[800])),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              children: [
                _buildVerificationRow('Detected Serial', s.detectedSerialNumber, s.isSerialMatch),
                const Divider(height: 24),
                _buildVerificationRow('Tamper Check', s.isTamperingDetected ? 'Tampering Detected' : 'No Tampering', !s.isTamperingDetected),
                const Divider(height: 24),
                _buildVerificationRow('Structural Integrity', '${s.structuralIntegrityPct}%', s.structuralIntegrityPct > 90),
                const SizedBox(height: 24),
                const Align(alignment: Alignment.centerLeft, child: Text('Cryptographic Image Hash', style: TextStyle(color: Colors.grey, fontSize: 12))),
                const SizedBox(height: 4),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  color: Colors.grey[100],
                  child: Text(s.cryptographicHash, style: const TextStyle(fontFamily: 'monospace', fontSize: 12)),
                )
              ],
            ),
          )
        ],
      ),
    );
  }

  Widget _buildVerificationRow(String label, String value, bool isOk) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: const TextStyle(color: Colors.grey)),
        Row(
          children: [
            Text(value, style: const TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(width: 8),
            Icon(isOk ? Icons.check_circle : Icons.cancel, color: isOk ? Colors.green : Colors.red, size: 20),
          ],
        )
      ],
    );
  }

  Widget _buildScannerButton() {
    return Container(
      padding: const EdgeInsets.all(24),
      color: Colors.white,
      child: SizedBox(
        width: double.infinity,
        height: 56,
        child: ElevatedButton.icon(
          onPressed: _isScanning ? null : _captureAndAnalyze,
          icon: const Icon(Icons.camera),
          label: const Text('SCAN BOLT SEAL', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          style: ElevatedButton.styleFrom(backgroundColor: Colors.blueGrey[900], foregroundColor: Colors.white),
        ),
      ),
    );
  }
}
