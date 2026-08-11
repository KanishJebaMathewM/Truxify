import 'package:flutter/material.dart';
import 'dart:async';
import '../models/yard_trailer_model.dart';
import '../services/drone_inventory_service.dart';
import 'package:intl/intl.dart';

class YardInventoryDashboard extends StatefulWidget {
  const YardInventoryDashboard({super.key});

  @override
  State<YardInventoryDashboard> createState() => _YardInventoryDashboardState();
}

class _YardInventoryDashboardState extends State<YardInventoryDashboard> {
  final DroneInventoryService _droneService = DroneInventoryService();
  StreamSubscription? _subscription;
  final List<YardTrailer> _scannedTrailers = [];
  bool _isScanning = false;

  void _startDroneMission() {
    setState(() {
      _isScanning = true;
      _scannedTrailers.clear();
    });

    _subscription = _droneService.startDroneYardScan().listen((trailer) {
      if (mounted) {
        setState(() {
          _scannedTrailers.insert(0, trailer); // Add newest scan to top
        });
        _playScanBeep(trailer.trailerId);
      }
    }, onDone: () {
      if (mounted) {
        setState(() {
          _isScanning = false;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Drone mission complete. Yard map updated.'), backgroundColor: Colors.green)
        );
      }
    });
  }

  void _playScanBeep(String id) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Drone scanned trailer: $id'),
        duration: const Duration(milliseconds: 1500),
        behavior: SnackBarBehavior.floating,
        margin: const EdgeInsets.only(top: 50.0, left: 20.0, right: 20.0),
      )
    );
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Drone Yard Management'),
        backgroundColor: Colors.teal[900],
      ),
      backgroundColor: Colors.grey[200],
      body: Column(
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(24),
            color: Colors.white,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Chicago Mega-Yard', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
                    Icon(Icons.flight_takeoff, color: _isScanning ? Colors.teal : Colors.grey, size: 32),
                  ],
                ),
                const SizedBox(height: 8),
                Text('Total Capacity: 500 spots | Scanned Today: ${_scannedTrailers.length}', style: const TextStyle(color: Colors.grey)),
                const SizedBox(height: 24),
                SizedBox(
                  width: double.infinity,
                  height: 50,
                  child: ElevatedButton.icon(
                    onPressed: _isScanning ? null : _startDroneMission,
                    icon: _isScanning ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)) : const Icon(Icons.radar),
                    label: Text(_isScanning ? 'DRONE IN FLIGHT...' : 'INITIATE DRONE SCAN'),
                    style: ElevatedButton.styleFrom(backgroundColor: Colors.teal[900], foregroundColor: Colors.white),
                  ),
                )
              ],
            ),
          ),
          const Padding(
            padding: EdgeInsets.all(16.0),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text('LIVE DRONE FEED', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.teal)),
            ),
          ),
          Expanded(
            child: _scannedTrailers.isEmpty
                ? const Center(child: Text('Awaiting drone telemetry...', style: TextStyle(color: Colors.grey)))
                : ListView.builder(
                    itemCount: _scannedTrailers.length,
                    itemBuilder: (context, index) {
                      return _buildTrailerCard(_scannedTrailers[index]);
                    },
                  ),
          )
        ],
      ),
    );
  }

  Widget _buildTrailerCard(YardTrailer trailer) {
    final timeFormat = DateFormat('HH:mm:ss');
    final isUnknown = trailer.status == 'UNKNOWN';
    
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      elevation: 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: isUnknown ? Colors.red : Colors.transparent, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: Colors.teal[50], borderRadius: BorderRadius.circular(8)),
              child: Icon(Icons.qr_code_scanner, color: Colors.teal[900], size: 32),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(trailer.trailerId, style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: isUnknown ? Colors.red : Colors.black)),
                  const SizedBox(height: 4),
                  Text('Located at: ${trailer.yardSpot}', style: TextStyle(color: Colors.grey[700])),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: trailer.status == 'LOADED' ? Colors.blue[100] : trailer.status == 'EMPTY' ? Colors.green[100] : Colors.red[100],
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(
                          trailer.status,
                          style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: trailer.status == 'LOADED' ? Colors.blue[900] : trailer.status == 'EMPTY' ? Colors.green[900] : Colors.red[900]),
                        ),
                      ),
                      const Spacer(),
                      Text(timeFormat.format(trailer.lastScanned), style: const TextStyle(color: Colors.grey, fontSize: 12)),
                    ],
                  )
                ],
              ),
            )
          ],
        ),
      ),
    );
  }
}
