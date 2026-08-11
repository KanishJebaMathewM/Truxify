import 'package:flutter/material.dart';
import '../models/smart_pallet_rfid_model.dart';
import '../services/smart_pallet_rfid_service.dart';

class SmartPalletRfidScreen extends StatefulWidget {
  const SmartPalletRfidScreen({super.key});

  @override
  State<SmartPalletRfidScreen> createState() => _SmartPalletRfidScreenState();
}

class _SmartPalletRfidScreenState extends State<SmartPalletRfidScreen> {
  final SmartPalletRfidService _service = SmartPalletRfidService();
  RfidMeshManifest? _manifest;
  bool _isScanning = false;

  void _runRfidSweep() async {
    setState(() {
      _isScanning = true;
      _manifest = null;
    });
    
    final result = await _service.scanTrailerMesh();
    
    if (mounted) {
      setState(() {
        _manifest = result;
        _isScanning = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Trailer RFID Mesh Network'),
        backgroundColor: Colors.blue[900],
      ),
      backgroundColor: Colors.grey[100],
      body: _buildBody(),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _isScanning ? null : _runRfidSweep,
        backgroundColor: Colors.blue[800],
        icon: const Icon(Icons.radar, color: Colors.white),
        label: Text(_isScanning ? 'SCANNING MESH...' : 'INITIATE RFID SWEEP', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
      ),
    );
  }

  Widget _buildBody() {
    if (_isScanning) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const SizedBox(width: 80, height: 80, child: CircularProgressIndicator(strokeWidth: 6)),
            const SizedBox(height: 24),
            Text('Pinging IoT Trailer Gateway...', style: TextStyle(color: Colors.blue[900], fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            const Text('Cross-referencing eBOL signatures...', style: TextStyle(color: Colors.grey)),
          ],
        ),
      );
    }

    if (_manifest == null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.inventory, size: 100, color: Colors.blue[100]),
            const SizedBox(height: 16),
            const Text('No mesh network data.', style: TextStyle(color: Colors.grey, fontSize: 18)),
            const Text('Initiate a sweep before leaving the dock.', style: TextStyle(color: Colors.grey)),
          ],
        ),
      );
    }

    return _buildDashboard();
  }

  Widget _buildDashboard() {
    final m = _manifest!;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _buildManifestSummary(m),
        const SizedBox(height: 24),
        const Text('PALLET MANIFEST', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
        const SizedBox(height: 8),
        ...m.pallets.map((p) => _buildPalletCard(p)),
        const SizedBox(height: 80), // Fab padding
      ],
    );
  }

  Widget _buildManifestSummary(RfidMeshManifest m) {
    final bool isShortage = !m.isManifestComplete;
    
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: isShortage ? Colors.red : Colors.green, width: 3),
      ),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(isShortage ? Icons.warning_amber_rounded : Icons.check_circle, color: isShortage ? Colors.red : Colors.green, size: 40),
                const SizedBox(width: 12),
                Text(
                  '${m.palletsScanned} / ${m.totalPalletsExpected} PALLETS',
                  style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: isShortage ? Colors.red : Colors.green),
                ),
              ],
            ),
            const SizedBox(height: 16),
            if (isShortage) ...[
              const Text('CARGO SHORTAGE DETECTED!', style: TextStyle(color: Colors.red, fontWeight: FontWeight.bold, fontSize: 18)),
              const Text('Do NOT leave the dock. A pallet is missing from the trailer.', textAlign: TextAlign.center, style: TextStyle(color: Colors.redAccent)),
            ] else ...[
              const Text('CUSTODY VERIFIED', style: TextStyle(color: Colors.green, fontWeight: FontWeight.bold, fontSize: 18)),
              const Text('All pallets accounted for. Cleared for departure.', textAlign: TextAlign.center, style: TextStyle(color: Colors.green)),
            ]
          ],
        ),
      ),
    );
  }

  Widget _buildPalletCard(RfidPallet p) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        leading: Icon(
          p.isScanned ? Icons.inventory_2 : Icons.question_mark,
          color: p.isScanned ? Colors.blue[700] : Colors.red,
          size: 32,
        ),
        title: Text(p.rfidTagId, style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Text(p.skuInfo),
        trailing: p.isScanned 
            ? Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.wifi, color: Colors.green, size: 16),
                  Text('${p.signalStrength.toInt()} dBm', style: const TextStyle(color: Colors.green, fontSize: 12)),
                ],
              )
            : const Text('MISSING', style: TextStyle(color: Colors.red, fontWeight: FontWeight.bold)),
      ),
    );
  }
}
