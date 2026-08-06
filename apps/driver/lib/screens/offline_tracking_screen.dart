import 'dart:async';
import 'package:flutter/material.dart';
import '../models/geohash_location_model.dart';
import '../services/offline_tracking_service.dart';

class OfflineTrackingScreen extends StatefulWidget {
  const OfflineTrackingScreen({super.key});

  @override
  State<OfflineTrackingScreen> createState() => _OfflineTrackingScreenState();
}

class _OfflineTrackingScreenState extends State<OfflineTrackingScreen> {
  final OfflineTrackingService _trackingService = OfflineTrackingService();
  bool _isCellularConnected = false;
  Timer? _gpsTimer;
  int _queueCount = 0;
  List<GeohashLocation> _visibleQueue = [];

  @override
  void initState() {
    super.initState();
    _trackingService.setConnectivity(_isCellularConnected);
    _startMockGps();
  }

  @override
  void dispose() {
    _gpsTimer?.cancel();
    super.dispose();
  }

  void _startMockGps() {
    _gpsTimer = Timer.periodic(const Duration(seconds: 2), (timer) {
      // Simulate driving
      _trackingService.recordLocation(41.8781 + (timer.tick * 0.001), -87.6298, 65.0);
      _updateUi();
    });
  }

  void _updateUi() {
    if (mounted) {
      setState(() {
        _queueCount = _trackingService.getQueue().length;
        _visibleQueue = _trackingService.getQueue().reversed.take(5).toList();
      });
    }
  }

  void _toggleNetwork() async {
    setState(() {
      _isCellularConnected = !_isCellularConnected;
      _trackingService.setConnectivity(_isCellularConnected);
    });

    if (_isCellularConnected) {
      final syncedCount = await _trackingService.syncData();
      if (mounted && syncedCount > 0) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Reconnected! Synced $syncedCount compressed geohashes to dispatch.'),
            backgroundColor: Colors.green[800],
          )
        );
        _updateUi();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Offline Telemetry Tracking'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: Column(
        children: [
          _buildNetworkDashboard(),
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: _visibleQueue.length,
              itemBuilder: (context, index) {
                return _buildGeohashCard(_visibleQueue[index]);
              },
            ),
          )
        ],
      ),
    );
  }

  Widget _buildNetworkDashboard() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: _isCellularConnected ? Colors.blueGrey[800] : Colors.red[900],
        borderRadius: const BorderRadius.only(bottomLeft: Radius.circular(24), bottomRight: Radius.circular(24)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Icon(_isCellularConnected ? Icons.cell_tower : Icons.signal_cellular_off, color: Colors.white, size: 64),
          const SizedBox(height: 16),
          Text(_isCellularConnected ? 'CONNECTED' : 'CELLULAR DEAD ZONE', style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Text(_isCellularConnected ? 'Transmitting live to dispatch.' : 'Compressing GPS data to local Geohash queue...', style: const TextStyle(color: Colors.white70)),
          const SizedBox(height: 24),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
            decoration: BoxDecoration(color: Colors.black26, borderRadius: BorderRadius.circular(16)),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.sd_storage, color: Colors.orangeAccent),
                const SizedBox(width: 12),
                Text('$_queueCount Payloads Pending', style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
              ],
            ),
          ),
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: _toggleNetwork,
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.white,
              foregroundColor: Colors.black,
            ),
            child: Text(_isCellularConnected ? 'SIMULATE NETWORK LOSS' : 'SIMULATE RECONNECTION'),
          )
        ],
      ),
    );
  }

  Widget _buildGeohashCard(GeohashLocation loc) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: const Icon(Icons.pin_drop, color: Colors.blueGrey),
        title: Text('Hash: ${loc.geohash}', style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.bold)),
        subtitle: Text('Recorded: ${loc.timestamp.toString().split('.')[0]}'),
        trailing: Text('${loc.speedMph} mph', style: const TextStyle(fontWeight: FontWeight.bold)),
      ),
    );
  }
}
