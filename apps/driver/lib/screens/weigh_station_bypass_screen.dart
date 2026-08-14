import 'package:flutter/material.dart';
import '../models/wim_bypass_model.dart';
import '../services/wim_bypass_service.dart';

class WeighStationBypassScreen extends StatefulWidget {
  const WeighStationBypassScreen({super.key});

  @override
  State<WeighStationBypassScreen> createState() => _WeighStationBypassScreenState();
}

class _WeighStationBypassScreenState extends State<WeighStationBypassScreen> {
  final WimBypassService _service = WimBypassService();
  WimBypassRequest? _currentState;
  bool _isMonitoring = false;

  void _startMonitoring() {
    setState(() {
      _isMonitoring = true;
    });

    _service.streamBypassStatus().listen((state) {
      if (mounted) {
        setState(() {
          _currentState = state;
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Smart WIM Bypass'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: !_isMonitoring
          ? Center(
              child: ElevatedButton.icon(
                onPressed: _startMonitoring,
                icon: const Icon(Icons.sensors),
                label: const Text('ENABLE HIGHWAY MONITORING', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.blueGrey[900],
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16)
                ),
              ),
            )
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    if (_currentState == null) return const Center(child: CircularProgressIndicator());

    final s = _currentState!;
    
    Color statusColor;
    IconData statusIcon;
    String mainText;

    switch (s.status) {
      case 'Cleared':
        statusColor = Colors.green[600]!;
        statusIcon = Icons.check_circle;
        mainText = 'BYPASS GRANTED';
        break;
      case 'Pull In':
        statusColor = Colors.red[700]!;
        statusIcon = Icons.stop_circle;
        mainText = 'PULL INTO WEIGH STATION';
        break;
      case 'Transmitting':
        statusColor = Colors.orange[600]!;
        statusIcon = Icons.wifi_tethering;
        mainText = 'TRANSMITTING WIM DATA';
        break;
      default:
        statusColor = Colors.blueGrey[600]!;
        statusIcon = Icons.radar;
        mainText = 'APPROACHING WEIGH STATION';
    }

    return Column(
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(vertical: 48, horizontal: 24),
          color: statusColor,
          child: Column(
            children: [
              Icon(statusIcon, color: Colors.white, size: 80),
              const SizedBox(height: 16),
              Text(mainText, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
              const SizedBox(height: 8),
              Text('${s.distanceMiles.toStringAsFixed(1)} miles ahead', style: const TextStyle(color: Colors.white70, fontSize: 18)),
            ],
          ),
        ),
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                _buildInfoCard('Location', s.stationName, Icons.location_on),
                const SizedBox(height: 16),
                _buildTransmissionDetails(s),
              ],
            ),
          ),
        )
      ],
    );
  }

  Widget _buildInfoCard(String title, String value, IconData icon) {
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        leading: Icon(icon, color: Colors.blueGrey),
        title: Text(title, style: const TextStyle(color: Colors.grey, fontSize: 12)),
        subtitle: Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.black)),
      ),
    );
  }

  Widget _buildTransmissionDetails(WimBypassRequest s) {
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('DOT Telematics Payload', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            const Divider(height: 24),
            _buildRow('Truck Safety Score', '${s.truckSafetyScore}/100'),
            const SizedBox(height: 8),
            _buildRow('Estimated Weight', '${s.estimatedGrossWeightLbs.toInt()} lbs'),
            const SizedBox(height: 8),
            _buildRow('Digital BOL', 'Attached'),
            const Divider(height: 24),
            const Text('Cryptographic Signature', style: TextStyle(color: Colors.grey, fontSize: 12)),
            const SizedBox(height: 4),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(8),
              color: Colors.grey[100],
              child: Text(s.cryptographicSignature, style: const TextStyle(fontFamily: 'monospace', fontSize: 12, color: Colors.blueGrey)),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildRow(String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: const TextStyle(color: Colors.grey)),
        Text(value, style: const TextStyle(fontWeight: FontWeight.bold)),
      ],
    );
  }
}
