import 'package:flutter/material.dart';
import '../models/predictive_maintenance_model.dart';
import '../services/predictive_maintenance_service.dart';

class PredictiveMaintenanceScreen extends StatefulWidget {
  const PredictiveMaintenanceScreen({super.key});

  @override
  State<PredictiveMaintenanceScreen> createState() => _PredictiveMaintenanceScreenState();
}

class _PredictiveMaintenanceScreenState extends State<PredictiveMaintenanceScreen> {
  final PredictiveMaintenanceService _service = PredictiveMaintenanceService();
  PredictiveMaintenanceSession? _session;

  @override
  void initState() {
    super.initState();
    _service.maintenanceStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.calculateMaintenanceSchedule();
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
        title: const Text('Predictive Maintenance AI'),
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
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (s.overdueTasks.isNotEmpty) ...[
                const Text('CRITICAL OVERDUE TASKS', style: TextStyle(color: Colors.red, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                const SizedBox(height: 12),
                ...s.overdueTasks.map((t) => _buildTaskCard(t, isOverdue: true)),
                const SizedBox(height: 24),
              ],
              const Text('UPCOMING SCHEDULE', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              if (s.upcomingTasks.isEmpty && s.overdueTasks.isEmpty)
                const Center(child: CircularProgressIndicator())
              else
                ...s.upcomingTasks.map((t) => _buildTaskCard(t, isOverdue: false)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(PredictiveMaintenanceSession s) {
    bool isComplete = s.status.contains('Optimized');
    bool hasCritical = s.overdueTasks.isNotEmpty;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: isComplete ? (hasCritical ? Colors.red[900] : Colors.teal[800]) : Colors.blueGrey[800],
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(isComplete ? (hasCritical ? Icons.warning : Icons.build_circle) : Icons.settings, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('FLEET HEALTH ENGINE', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildTaskCard(MaintenanceTask t, {required bool isOverdue}) {
    Color cardColor = isOverdue ? Colors.red[50]! : Colors.white;
    Color borderColor = isOverdue ? Colors.red[400]! : Colors.transparent;
    
    return Card(
      elevation: isOverdue ? 4 : 1,
      margin: const EdgeInsets.only(bottom: 12),
      color: cardColor,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: borderColor, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Icon(Icons.directions_car, color: Colors.blueGrey[700]),
                    const SizedBox(width: 8),
                    Text(t.truckId, style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.blueGrey[900])),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: t.priority == 'High' ? Colors.red : (t.priority == 'Medium' ? Colors.orange : Colors.blue),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Text(t.priority, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12)),
                )
              ],
            ),
            const Divider(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(t.taskName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                    const SizedBox(height: 4),
                    Text('Due at ${t.dueAtMiles} mi', style: const TextStyle(color: Colors.grey, fontSize: 14)),
                  ],
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      isOverdue ? '${t.currentMiles - t.dueAtMiles} mi Overdue' : '${t.milesRemaining} mi left',
                      style: TextStyle(
                        color: isOverdue ? Colors.red : Colors.green[700],
                        fontWeight: FontWeight.bold,
                        fontSize: 16
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text('Current: ${t.currentMiles}', style: const TextStyle(color: Colors.grey, fontSize: 12)),
                  ],
                )
              ],
            )
          ],
        ),
      ),
    );
  }
}
