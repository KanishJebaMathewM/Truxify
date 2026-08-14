import 'package:flutter/material.dart';
import '../models/cargo_theft_model.dart';
import '../services/cargo_theft_service.dart';

class CargoTheftScreen extends StatefulWidget {
  const CargoTheftScreen({super.key});

  @override
  State<CargoTheftScreen> createState() => _CargoTheftScreenState();
}

class _CargoTheftScreenState extends State<CargoTheftScreen> {
  final CargoTheftService _service = CargoTheftService();
  CargoTheftSession? _session;

  @override
  void initState() {
    super.initState();
    _service.theftStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateParkingSearch();
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
        title: const Text('Cargo Theft Heatmap Overlay'),
        backgroundColor: Colors.black87,
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final s = _session!;
    bool isDanger = !s.isSafeZone;
    bool isRerouting = s.status.contains('REROUTING');

    return Column(
      children: [
        _buildStatusHeader(s, isDanger, isRerouting),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (s.selectedLocation != null) _buildLocationCard(s.selectedLocation!, isDanger),
              if (isDanger) ...[
                const SizedBox(height: 24),
                _buildDangerAlert(s),
              ]
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(CargoTheftSession s, bool isDanger, bool isRerouting) {
    Color headerColor = Colors.blueGrey[800]!;
    IconData icon = Icons.location_searching;
    
    if (isDanger) {
      headerColor = Colors.red[900]!;
      icon = Icons.warning;
    } else if (isRerouting) {
      headerColor = Colors.green[800]!;
      icon = Icons.security;
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
              const Text('SECURITY AI SCAN', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildLocationCard(ParkingLocation loc, bool isDanger) {
    return Card(
      elevation: isDanger ? 8 : 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: isDanger ? Colors.red : (loc.securityScore > 80 ? Colors.green : Colors.transparent), width: 2),
      ),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: isDanger ? Colors.red[50] : Colors.grey[100],
              borderRadius: const BorderRadius.only(topLeft: Radius.circular(16), topRight: Radius.circular(16)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(loc.locationName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                      const SizedBox(height: 4),
                      Text(loc.locationType, style: TextStyle(color: Colors.grey[700])),
                    ],
                  ),
                ),
                Icon(isDanger ? Icons.dangerous : Icons.shield, color: isDanger ? Colors.red : Colors.green[700], size: 32),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    _buildSecurityFeature(loc.hasFencing, 'Fencing', Icons.fence),
                    _buildSecurityFeature(loc.hasGuards, 'Guards', Icons.local_police),
                  ],
                ),
                const Divider(height: 32),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Security Score:', style: TextStyle(fontSize: 16, color: Colors.grey)),
                    Text('${loc.securityScore}/100', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 24, color: isDanger ? Colors.red[900] : Colors.green[800])),
                  ],
                ),
              ],
            ),
          )
        ],
      ),
    );
  }

  Widget _buildSecurityFeature(bool isPresent, String label, IconData icon) {
    return Column(
      children: [
        Icon(icon, color: isPresent ? Colors.green : Colors.grey, size: 28),
        const SizedBox(height: 8),
        Text(isPresent ? 'Yes' : 'No', style: TextStyle(fontWeight: FontWeight.bold, color: isPresent ? Colors.green[700] : Colors.grey)),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }

  Widget _buildDangerAlert(CargoTheftSession s) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(color: Colors.red[900], borderRadius: BorderRadius.circular(12)),
      child: Column(
        children: [
          const Icon(Icons.warning_amber_rounded, color: Colors.white, size: 48),
          const SizedBox(height: 12),
          Text('${s.recentTheftsInArea} CARGO THEFTS REPORTED', textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          const Text('in this exact location over the last 7 days.', textAlign: TextAlign.center, style: TextStyle(color: Colors.white70, fontSize: 14)),
          const SizedBox(height: 16),
          const Text('DO NOT PARK HERE.', textAlign: TextAlign.center, style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 2)),
        ],
      ),
    );
  }
}
