import 'package:flutter/material.dart';
import '../models/hos_predictor_model.dart';
import '../services/hos_predictor_service.dart';

class HosPredictorScreen extends StatefulWidget {
  const HosPredictorScreen({super.key});

  @override
  State<HosPredictorScreen> createState() => _HosPredictorScreenState();
}

class _HosPredictorScreenState extends State<HosPredictorScreen> {
  final HosPredictorService _service = HosPredictorService();
  HosPredictorSession? _session;

  @override
  void initState() {
    super.initState();
    _service.predictorStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.initializeDashboard();
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
        title: const Text('HOS Compliance Engine'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _session?.isSimulating == true ? null : () => _showAssignmentSimulationDialog(context),
        backgroundColor: Colors.indigo,
        icon: const Icon(Icons.assignment),
        label: const Text('Simulate Dispatch Assignment'),
      ),
    );
  }

  void _showAssignmentSimulationDialog(BuildContext context) {
    showModalBottomSheet(
      context: context,
      builder: (context) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Padding(
                padding: EdgeInsets.all(16.0),
                child: Text('Simulate Dispatch', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
              ),
              ListTile(
                leading: const Icon(Icons.local_shipping, color: Colors.green),
                title: const Text('Short Haul (300 Miles)'),
                subtitle: const Text('Local delivery'),
                onTap: () {
                  Navigator.pop(context);
                  _service.simulateAssignment('LD-SHRT', 300);
                },
              ),
              ListTile(
                leading: const Icon(Icons.local_shipping, color: Colors.red),
                title: const Text('Long Haul (800 Miles)'),
                subtitle: const Text('Cross-country route'),
                onTap: () {
                  Navigator.pop(context);
                  _service.simulateAssignment('LD-LONG', 800);
                },
              ),
            ],
          ),
        );
      }
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
              if (s.driverState != null)
                _buildDriverCard(s.driverState!),
              const SizedBox(height: 24),
              if (s.simulationResult != null)
                _buildSimulationCard(s.simulationResult!),
              const SizedBox(height: 80), // Padding for FAB
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(HosPredictorSession s) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: s.isSimulating ? Colors.indigo[600] : Colors.blueGrey[800],
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              s.isSimulating 
                ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3))
                : const Icon(Icons.verified_user, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('DOT COMPLIANCE PREDICTOR', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildDriverCard(HosDriverState driver) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Row(
              children: [
                const Icon(Icons.person, color: Colors.indigo),
                const SizedBox(width: 12),
                Text(driver.driverName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildMetric('Daily Drive Clock', '${driver.hoursRemainingDaily.toStringAsFixed(1)} HRS', Colors.blueGrey),
                _buildMetric('70-Hour Weekly Clock', '${driver.hoursRemainingWeekly.toStringAsFixed(1)} HRS', Colors.orange), // Low hours
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildMetric(String label, String value, Color color) {
    return Column(
      children: [
        Text(value, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: color)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }

  Widget _buildSimulationCard(HosSimulationResult result) {
    Color riskColor = result.isViolationInevitable ? Colors.red : Colors.green;
    IconData riskIcon = result.isViolationInevitable ? Icons.block : Icons.check_circle;

    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: riskColor, width: 3),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(riskIcon, color: riskColor, size: 36),
                const SizedBox(width: 12),
                Text(
                  result.isViolationInevitable ? 'DISPATCH BLOCKED' : 'DISPATCH APPROVED', 
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 22, color: riskColor)
                ),
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildMetric('Load ID', result.loadId, Colors.blueGrey),
                _buildMetric('Req. Transit Time', '${result.requiredTransitHours.toStringAsFixed(1)} HRS', riskColor),
              ],
            ),
            const SizedBox(height: 24),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: riskColor.withOpacity(0.1), borderRadius: BorderRadius.circular(8)),
              child: Text(
                result.violationReason,
                style: TextStyle(color: riskColor, fontWeight: FontWeight.bold, fontSize: 14),
                textAlign: TextAlign.center,
              ),
            ),
            if (result.isViolationInevitable) ...[
              const SizedBox(height: 16),
              ElevatedButton.icon(
                onPressed: null, // Hard blocked
                icon: const Icon(Icons.close),
                label: const Text('Assignment Locked by Compliance Engine'),
                style: ElevatedButton.styleFrom(
                  disabledBackgroundColor: Colors.red[100],
                  disabledForegroundColor: Colors.red[900],
                ),
              )
            ] else ...[
              const SizedBox(height: 16),
              ElevatedButton.icon(
                onPressed: () {}, 
                icon: const Icon(Icons.send),
                label: const Text('Confirm Assignment'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.green,
                  foregroundColor: Colors.white,
                ),
              )
            ]
          ],
        ),
      ),
    );
  }
}
