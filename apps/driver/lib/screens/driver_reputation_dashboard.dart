import 'package:flutter/material.dart';
import '../models/driver_reputation_model.dart';
import '../services/reputation_scoring_engine.dart';

class DriverReputationDashboard extends StatefulWidget {
  final String driverId;
  const DriverReputationDashboard({super.key, required this.driverId});

  @override
  State<DriverReputationDashboard> createState() => _DriverReputationDashboardState();
}

class _DriverReputationDashboardState extends State<DriverReputationDashboard> {
  final ReputationScoringEngine _engine = ReputationScoringEngine();
  DriverReputation? _reputation;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadReputation();
  }

  Future<void> _loadReputation() async {
    final rep = await _engine.fetchDriverReputation(widget.driverId);
    if (mounted) {
      setState(() {
        _reputation = rep;
        _isLoading = false;
      });
    }
  }

  Color _getTierColor(String tier) {
    switch (tier) {
      case 'PLATINUM': return Colors.cyan[300]!;
      case 'GOLD': return Colors.amber;
      case 'SILVER': return Colors.grey[400]!;
      case 'BRONZE': return Colors.deepOrange[300]!;
      default: return Colors.white;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('My Reputation Profile'),
        backgroundColor: Colors.indigo[900],
      ),
      backgroundColor: Colors.grey[100],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(24.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _buildScoreHeader(),
                  const SizedBox(height: 24),
                  const Text('Objective Telemetry Data', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 12),
                  _buildMetricCard(
                    'On-Time Delivery',
                    '${_reputation!.onTimePercentage.toStringAsFixed(1)}%',
                    Icons.schedule,
                    Colors.green,
                  ),
                  _buildMetricCard(
                    'Damage Claims Ratio',
                    '${_reputation!.claimsRatio.toStringAsFixed(2)}%',
                    Icons.broken_image,
                    _reputation!.claimsRatio > 1.0 ? Colors.red : Colors.green,
                  ),
                  _buildMetricCard(
                    'Hard Braking Events (30 Days)',
                    '${_reputation!.hardBrakingEvents}',
                    Icons.warning_amber_rounded,
                    _reputation!.hardBrakingEvents > 10 ? Colors.red : Colors.orange,
                  ),
                  const SizedBox(height: 32),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(color: Colors.indigo[50], borderRadius: BorderRadius.circular(8)),
                    child: Row(
                      children: [
                        Icon(Icons.info_outline, color: Colors.indigo[800]),
                        const SizedBox(width: 12),
                        const Expanded(
                          child: Text(
                            'Your Platinum tier gives you priority access to high-paying loads before they hit the public load board.',
                            style: TextStyle(fontSize: 14),
                          ),
                        )
                      ],
                    ),
                  )
                ],
              ),
            ),
    );
  }

  Widget _buildScoreHeader() {
    final color = _getTierColor(_reputation!.tier);
    return Card(
      elevation: 6,
      color: Colors.indigo[800],
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(32.0),
        child: Column(
          children: [
            Text('RELIABILITY SCORE', style: TextStyle(color: Colors.indigo[200], letterSpacing: 2, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            Text(
              _reputation!.overallScore.toStringAsFixed(0),
              style: TextStyle(fontSize: 84, fontWeight: FontWeight.bold, color: color),
            ),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              decoration: BoxDecoration(
                color: color.withOpacity(0.2),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: color),
              ),
              child: Text(
                '${_reputation!.tier} TIER',
                style: TextStyle(color: color, fontWeight: FontWeight.bold, letterSpacing: 1),
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildMetricCard(String title, String value, IconData icon, Color iconColor) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: iconColor.withOpacity(0.1),
          child: Icon(icon, color: iconColor),
        ),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.bold)),
        trailing: Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
      ),
    );
  }
}
