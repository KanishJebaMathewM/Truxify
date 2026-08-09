import 'package:flutter/material.dart';
import '../models/pallet_dimension_model.dart';
import '../services/lidar_dimension_service.dart';

class LidarScannerScreen extends StatefulWidget {
  const LidarScannerScreen({super.key});

  @override
  State<LidarScannerScreen> createState() => _LidarScannerScreenState();
}

class _LidarScannerScreenState extends State<LidarScannerScreen> {
  final LidarDimensionService _lidarService = LidarDimensionService();
  PalletScanResult? _result;
  bool _isScanning = false;
  String _scanProgressText = '';

  void _startScan() async {
    setState(() {
      _isScanning = true;
      _scanProgressText = 'Initializing LiDAR Sensor...';
    });
    
    await Future.delayed(const Duration(seconds: 1));
    setState(() => _scanProgressText = 'Mapping Point Cloud...');
    
    await Future.delayed(const Duration(seconds: 1));
    setState(() => _scanProgressText = 'Calculating Bounding Box...');

    final result = await _lidarService.perform3DScan();
    
    if (mounted) {
      setState(() {
        _result = result;
        _isScanning = false;
      });
    }
  }

  void _resetScanner() {
    setState(() {
      _result = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('LTL LiDAR Dimensioner'),
        backgroundColor: Colors.purple[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _isScanning 
          ? _buildScanningOverlay() 
          : (_result == null ? _buildPreScanView() : _buildResultsView()),
    );
  }

  Widget _buildPreScanView() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.view_in_ar, size: 100, color: Colors.purple[300]),
            const SizedBox(height: 24),
            const Text(
              'Ready to Scan',
              style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            const Text(
              'Aim your camera at the pallet. Walk slowly around it to capture the full 3D point cloud and calculate exact dimensions.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.grey, fontSize: 16),
            ),
            const SizedBox(height: 40),
            SizedBox(
              width: double.infinity,
              height: 60,
              child: ElevatedButton.icon(
                onPressed: _startScan,
                icon: const Icon(Icons.camera_alt),
                label: const Text('BEGIN LIDAR SCAN', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                style: ElevatedButton.styleFrom(backgroundColor: Colors.purple[900], foregroundColor: Colors.white),
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildScanningOverlay() {
    return Container(
      color: Colors.black87,
      width: double.infinity,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const SizedBox(
            width: 150,
            height: 150,
            child: CircularProgressIndicator(color: Colors.purpleAccent, strokeWidth: 8),
          ),
          const SizedBox(height: 40),
          Text(_scanProgressText, style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          const Text('Keep device steady', style: TextStyle(color: Colors.white54)),
        ],
      ),
    );
  }

  Widget _buildResultsView() {
    final r = _result!;
    final isDiscrepancy = r.originalClass != r.recommendedFreightClass;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          if (isDiscrepancy)
            Container(
              padding: const EdgeInsets.all(16),
              margin: const EdgeInsets.bottom(16),
              decoration: BoxDecoration(color: Colors.red[50], border: Border.all(color: Colors.red[300]!), borderRadius: BorderRadius.circular(12)),
              child: Row(
                children: [
                  Icon(Icons.warning_amber_rounded, color: Colors.red[800], size: 40),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Dimension Discrepancy Detected', style: TextStyle(color: Colors.red[900], fontWeight: FontWeight.bold, fontSize: 16)),
                        const SizedBox(height: 4),
                        Text('Shipper declared ${r.originalClass}. LiDAR scan indicates ${r.recommendedFreightClass}.', style: TextStyle(color: Colors.red[800])),
                      ],
                    ),
                  )
                ],
              ),
            ),
          
          Card(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: Column(
              children: [
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: Colors.purple[900], borderRadius: const BorderRadius.only(topLeft: Radius.circular(12), topRight: Radius.circular(12))),
                  child: const Text('SCANNED DIMENSIONS', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
                ),
                Padding(
                  padding: const EdgeInsets.all(24.0),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                    children: [
                      _buildDimensionCol('Length', r.lengthInches),
                      const Text('X', style: TextStyle(color: Colors.grey, fontSize: 20)),
                      _buildDimensionCol('Width', r.widthInches),
                      const Text('X', style: TextStyle(color: Colors.grey, fontSize: 20)),
                      _buildDimensionCol('Height', r.heightInches),
                    ],
                  ),
                ),
                const Divider(),
                Padding(
                  padding: const EdgeInsets.all(20.0),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Calculated Volume:', style: TextStyle(color: Colors.grey, fontSize: 16)),
                      Text('${r.calculatedCubicFeet} cu. ft.', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 20)),
                    ],
                  ),
                )
              ],
            ),
          ),
          const SizedBox(height: 16),
          Card(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: Padding(
              padding: const EdgeInsets.all(20.0),
              child: Column(
                children: [
                  const Text('Projected Invoice Adjustment', style: TextStyle(color: Colors.grey)),
                  const SizedBox(height: 8),
                  Text('+\$${r.projectedRevenueIncrease.toStringAsFixed(2)}', style: TextStyle(fontSize: 48, fontWeight: FontWeight.bold, color: Colors.green[700])),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    height: 50,
                    child: ElevatedButton(
                      onPressed: () {
                         ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Invoice dynamically updated with scanned dimensions.')));
                         _resetScanner();
                      },
                      style: ElevatedButton.styleFrom(backgroundColor: Colors.green[700], foregroundColor: Colors.white),
                      child: const Text('UPDATE INVOICE & PROCEED', style: TextStyle(fontWeight: FontWeight.bold)),
                    ),
                  )
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          TextButton(onPressed: _resetScanner, child: const Text('Rescan Pallet', style: TextStyle(color: Colors.grey)))
        ],
      ),
    );
  }

  Widget _buildDimensionCol(String label, double val) {
    return Column(
      children: [
        Text('$val"', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold)),
        Text(label, style: const TextStyle(color: Colors.grey)),
      ],
    );
  }
}
