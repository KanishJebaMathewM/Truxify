import 'package:flutter/material.dart';
import '../models/lidar_dimensioning_model.dart';
import '../services/lidar_dimensioning_service.dart';

class LidarDimensioningScreen extends StatefulWidget {
  const LidarDimensioningScreen({super.key});

  @override
  State<LidarDimensioningScreen> createState() => _LidarDimensioningScreenState();
}

class _LidarDimensioningScreenState extends State<LidarDimensioningScreen> {
  final LidarDimensioningService _service = LidarDimensioningService();
  LidarScanSession? _session;

  @override
  void initState() {
    super.initState();
    _service.scanStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateLidarScan();
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
        title: const Text('LiDAR Dimensioning'),
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
        if (s.scanProgressPct < 100.0) _buildProgressBar(s),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (s.actualScanned != null) _buildDiscrepancyCard(s),
              const SizedBox(height: 24),
              const Text('DIMENSION COMPARISON', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildDimensionsGrid(s),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(LidarScanSession s) {
    Color headerColor = Colors.blueGrey[800]!;
    IconData icon = Icons.view_in_ar;
    
    if (s.scanProgressPct == 100.0) {
      headerColor = Colors.red[800]!;
      icon = Icons.warning_amber_rounded;
    } else if (s.scanProgressPct > 0) {
      headerColor = Colors.blue[700]!;
      icon = Icons.360;
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
              const Text('3D POINT CLOUD', style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }
  
  Widget _buildProgressBar(LidarScanSession s) {
    return LinearProgressIndicator(
      value: s.scanProgressPct / 100.0,
      minHeight: 8,
      backgroundColor: Colors.blueGrey[100],
      color: Colors.blue,
    );
  }

  Widget _buildDiscrepancyCard(LidarScanSession s) {
    return Card(
      elevation: 6,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: const BorderSide(color: Colors.red, width: 2)),
      child: Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(color: Colors.red[50], borderRadius: BorderRadius.circular(16)),
        child: Column(
          children: [
            const Text('REVENUE RECOVERED', style: TextStyle(color: Colors.red, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            const SizedBox(height: 8),
            Text('+\$${s.revenueRecoveredDollars.toStringAsFixed(2)}', style: TextStyle(color: Colors.green[800], fontSize: 48, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            const Text('Shipper under-reported pallet height by 22 inches. Invoice automatically updated.', textAlign: TextAlign.center, style: TextStyle(color: Colors.black87, fontSize: 14)),
          ],
        ),
      ),
    );
  }

  Widget _buildDimensionsGrid(LidarScanSession s) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(child: _buildDimensionColumn('Reported (BOL)', s.shipperReported, Colors.grey[700]!)),
        const SizedBox(width: 16),
        Expanded(child: _buildDimensionColumn('Actual (LiDAR)', s.actualScanned, Colors.blue[900]!)),
      ],
    );
  }
  
  Widget _buildDimensionColumn(String title, PalletDimensions? dims, Color headerColor) {
    if (dims == null) {
      return Card(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: Colors.grey[300]!)),
        child: const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())),
      );
    }
    
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: Colors.grey[300]!)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Text(title, style: TextStyle(color: headerColor, fontWeight: FontWeight.bold)),
            const Divider(height: 24),
            _buildDimRow('L x W x H', '${dims.lengthInches}" x ${dims.widthInches}" x ${dims.heightInches}"'),
            const SizedBox(height: 12),
            _buildDimRow('Volume', '${dims.totalCubicFeet} ft³'),
            const SizedBox(height: 12),
            _buildDimRow('Class', 'Class ${dims.estimatedFreightClass}', highlight: true),
          ],
        ),
      ),
    );
  }
  
  Widget _buildDimRow(String label, String value, {bool highlight = false}) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
        Text(value, style: TextStyle(fontWeight: highlight ? FontWeight.bold : FontWeight.normal, fontSize: 14)),
      ],
    );
  }
}
