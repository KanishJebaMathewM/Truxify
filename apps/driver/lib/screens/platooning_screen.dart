import 'package:flutter/material.dart';
import '../models/platooning_model.dart';
import '../services/platooning_service.dart';

class PlatooningScreen extends StatefulWidget {
  const PlatooningScreen({super.key});

  @override
  State<PlatooningScreen> createState() => _PlatooningScreenState();
}

class _PlatooningScreenState extends State<PlatooningScreen> {
  final PlatooningService _service = PlatooningService();
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
        title: const Text('V2V Platooning'),
        backgroundColor: Colors.blue[900],
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
              _buildSavingsCard(s),
              const SizedBox(height: 24),
              const Text('CONVOY TELEMETRY', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              ...s.members.map((member) => _buildMemberCard(member, s.optimalGapFeet)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(PlatoonSession s) {
    Color headerColor = Colors.orange[800]!;
    IconData icon = Icons.bluetooth_searching;
    
    if (s.status == 'Active Platooning') {
      headerColor = Colors.green[700]!;
      icon = Icons.sync_alt;
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
              Text(s.status.toUpperCase(), style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text('Target Speed: ${s.targetSpeedMph.toInt()} MPH | Optimal Gap: ${s.optimalGapFeet.toInt()} ft', style: const TextStyle(color: Colors.white, fontSize: 16)),
        ],
      ),
    );
  }

  Widget _buildSavingsCard(PlatoonSession s) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const Text('TOTAL PLATOON SAVINGS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildMetric('${s.totalFuelSavedGallons.toStringAsFixed(1)} gal', 'Fuel Saved', Colors.blue),
                _buildMetric('\$${s.totalFinancialSavings.toStringAsFixed(2)}', 'Financial Benefit', Colors.green),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildMemberCard(PlatoonMember m, double optimalGap) {
    bool isLead = m.role == 'Lead Truck';
    bool gapWarning = !isLead && (m.followDistanceFeet < optimalGap - 10 || m.followDistanceFeet > optimalGap + 10);
    
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: isLead ? Colors.blue[300]! : Colors.grey[300]!, width: isLead ? 2 : 1),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Icon(isLead ? Icons.looks_one : Icons.looks_two, color: isLead ? Colors.blue : Colors.grey[600]),
                    const SizedBox(width: 8),
                    Text(m.truckId, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  decoration: BoxDecoration(color: isLead ? Colors.blue[50] : Colors.grey[100], borderRadius: BorderRadius.circular(12)),
                  child: Text(m.role, style: TextStyle(color: isLead ? Colors.blue[900] : Colors.grey[800], fontWeight: FontWeight.bold, fontSize: 12)),
                )
              ],
            ),
            const Divider(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildSmallMetric('Speed', '${m.currentSpeedMph.toInt()} MPH'),
                if (!isLead)
                  _buildSmallMetric('Gap', '${m.followDistanceFeet.toInt()} ft', warning: gapWarning),
                _buildSmallMetric('Aero Savings', '${m.fuelSavingsPct.toStringAsFixed(1)}%', highlight: true),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildMetric(String value, String label, Color color) {
    return Column(
      children: [
        Text(value, style: TextStyle(color: color, fontSize: 32, fontWeight: FontWeight.bold)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 14)),
      ],
    );
  }
  
  Widget _buildSmallMetric(String label, String value, {bool warning = false, bool highlight = false}) {
    Color valueColor = Colors.black87;
    if (warning) valueColor = Colors.orange[800]!;
    if (highlight) valueColor = Colors.green[700]!;

    return Column(
      children: [
        Text(value, style: TextStyle(color: valueColor, fontSize: 20, fontWeight: FontWeight.bold)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }
}
