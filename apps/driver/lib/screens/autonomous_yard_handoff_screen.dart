import 'package:flutter/material.dart';
import '../models/autonomous_yard_handoff_model.dart';
import '../services/autonomous_yard_handoff_service.dart';

class AutonomousYardHandoffScreen extends StatefulWidget {
  const AutonomousYardHandoffScreen({super.key});

  @override
  State<AutonomousYardHandoffScreen> createState() => _AutonomousYardHandoffScreenState();
}

class _AutonomousYardHandoffScreenState extends State<AutonomousYardHandoffScreen> {
  final AutonomousYardHandoffService _service = AutonomousYardHandoffService();
  YardHandoffSession? _session;

  @override
  void initState() {
    super.initState();
    _service.handoffStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateHandoff();
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
        title: const Text('Autonomous Yard Handoff'),
        backgroundColor: Colors.indigo[900],
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
              _buildFacilityCard(s),
              const SizedBox(height: 24),
              const Text('AUTONOMOUS YARD DOG', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              s.yardDog == null
                ? _buildWaitingForBotCard()
                : _buildYardDogCard(s.yardDog!),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(YardHandoffSession s) {
    Color headerColor = Colors.indigo[800]!;
    IconData icon = Icons.location_on;
    
    if (s.sessionStatus == 'Handoff in Progress') {
      headerColor = Colors.orange[800]!;
      icon = Icons.precision_manufacturing;
    } else if (s.sessionStatus == 'Handoff Complete - Clear to Leave') {
      headerColor = Colors.green[700]!;
      icon = Icons.check_circle;
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
              Text(s.facilityName, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 24),
          Text(s.sessionStatus.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
        ],
      ),
    );
  }

  Widget _buildFacilityCard(YardHandoffSession s) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const Text('ASSIGNED DROP ZONE', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            const SizedBox(height: 16),
            Text(s.dropZoneGate, style: TextStyle(color: Colors.indigo[900], fontSize: 32, fontWeight: FontWeight.bold)),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.timer, color: Colors.green),
                const SizedBox(width: 8),
                Text('Time Saved: ${s.estimatedTimeSavedMinutes} mins', style: const TextStyle(color: Colors.green, fontWeight: FontWeight.bold, fontSize: 16)),
              ],
            )
          ],
        ),
      ),
    );
  }
  
  Widget _buildWaitingForBotCard() {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: BorderSide(color: Colors.grey[300]!)),
      child: const Padding(
        padding: EdgeInsets.all(32),
        child: Center(
          child: Column(
            children: [
              CircularProgressIndicator(color: Colors.indigo),
              const SizedBox(height: 16),
              const Text('Pull into the Drop Zone to trigger autonomous dispatch.', textAlign: TextAlign.center, style: TextStyle(color: Colors.grey)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildYardDogCard(YardDogTelemetry dog) {
    bool isComplete = dog.status == 'En Route to Dock';

    return Card(
      elevation: 6,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: isComplete ? Colors.green : Colors.indigo[300]!, width: 2),
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
                    Icon(Icons.smart_toy, color: isComplete ? Colors.green : Colors.indigo),
                    const SizedBox(width: 8),
                    Text(dog.botId, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  decoration: BoxDecoration(color: isComplete ? Colors.green[50] : Colors.orange[50], borderRadius: BorderRadius.circular(12)),
                  child: Text(dog.status, style: TextStyle(color: isComplete ? Colors.green[900] : Colors.orange[900], fontWeight: FontWeight.bold, fontSize: 12)),
                )
              ],
            ),
            const Divider(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildSmallMetric('Destination', dog.assignedDock, Icons.store),
                _buildSmallMetric('Battery', '${dog.batteryPct.toStringAsFixed(1)}%', Icons.battery_charging_full),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildSmallMetric(String label, String value, IconData icon) {
    return Column(
      children: [
        Icon(icon, color: Colors.grey[600]),
        const SizedBox(height: 8),
        Text(value, style: const TextStyle(color: Colors.black87, fontSize: 16, fontWeight: FontWeight.bold)),
        const SizedBox(height: 2),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }
}
