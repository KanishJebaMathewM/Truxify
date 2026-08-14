import 'package:flutter/material.dart';
import '../models/platoon_drafting_model.dart';
import '../services/platoon_drafting_service.dart';

class PlatoonDraftingScreen extends StatefulWidget {
  const PlatoonDraftingScreen({super.key});

  @override
  State<PlatoonDraftingScreen> createState() => _PlatoonDraftingScreenState();
}

class _PlatoonDraftingScreenState extends State<PlatoonDraftingScreen> {
  final PlatoonDraftingService _service = PlatoonDraftingService();
  PlatoonSession? _session;

  @override
  void initState() {
    super.initState();
    _service.platoonStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulatePlatooning();
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
        title: const Text('V2V Platoon Sync'),
        backgroundColor: Colors.cyan[900],
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
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (s.isPlatoonActive) ...[
                _buildSavingsCard(s.aerodynamicFuelSavingsPercent),
                const SizedBox(height: 24),
              ],
              const Text('V2V TELEMETRY LINK', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildTelemetryRadar(s),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(PlatoonSession s) {
    Color headerColor = s.isPlatoonActive ? Colors.green[700]! : Colors.cyan[800]!;
    IconData icon = s.isPlatoonActive ? Icons.multiple_stop : Icons.radar;

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
              const Text('COOPERATIVE ADAS', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildSavingsCard(double fuelSavings) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: Colors.green[50],
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.green, width: 2),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('AERODYNAMIC DRAFT', style: TextStyle(color: Colors.green, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
                SizedBox(height: 4),
                Text('Active Fuel Savings', style: TextStyle(color: Colors.grey, fontSize: 12)),
              ],
            ),
            Text('+${fuelSavings.toStringAsFixed(1)}%', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 32, color: Colors.green[800])),
          ],
        ),
      ),
    );
  }

  Widget _buildTelemetryRadar(PlatoonSession s) {
    bool hasLead = s.leadTruck != null;

    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            if (hasLead) ...[
              _buildTruckIcon(s.leadTruck!.truckId, Colors.blueGrey, true),
              _buildConnectionLink(s.isPlatoonActive, s.selfTruck!.followingDistanceFeet, s.selfTruck!.brakeSyncLatencyMs),
            ] else ...[
               const Padding(
                 padding: EdgeInsets.symmetric(vertical: 40),
                 child: Icon(Icons.search, size: 48, color: Colors.grey),
               )
            ],
            _buildTruckIcon(s.selfTruck!.truckId, s.isPlatoonActive ? Colors.green : Colors.cyan[900]!, false),
          ],
        ),
      ),
    );
  }

  Widget _buildConnectionLink(bool isActive, double distance, double latency) {
    Color linkColor = isActive ? Colors.green : Colors.orange;
    
    return Column(
      children: [
        Container(
          width: 4,
          height: 60,
          color: linkColor,
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          decoration: BoxDecoration(
            color: linkColor.withOpacity(0.1),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: linkColor),
          ),
          child: Column(
            children: [
              Text('${distance.toInt()} ft GAP', style: TextStyle(fontWeight: FontWeight.bold, color: linkColor, fontSize: 16)),
              Text('Brake Sync: ${latency.toStringAsFixed(1)} ms', style: const TextStyle(color: Colors.grey, fontSize: 12)),
            ],
          ),
        ),
        Container(
          width: 4,
          height: 60,
          color: linkColor,
        ),
      ],
    );
  }

  Widget _buildTruckIcon(String label, Color color, bool isLead) {
    return Column(
      children: [
        Icon(Icons.local_shipping, size: 64, color: color),
        Text(label, style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.grey)),
        if (isLead) const Text('Lead Windbreaker', style: TextStyle(fontSize: 10, color: Colors.blueGrey)),
      ],
    );
  }
}
