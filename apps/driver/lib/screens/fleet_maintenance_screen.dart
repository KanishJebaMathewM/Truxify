import 'package:flutter/material.dart';
import '../models/brake_pad_analytics_model.dart';
import '../services/brake_pad_analytics_service.dart';

class FleetMaintenanceScreen extends StatefulWidget {
  const FleetMaintenanceScreen({super.key});

  @override
  State<FleetMaintenanceScreen> createState() => _FleetMaintenanceScreenState();
}

class _FleetMaintenanceScreenState extends State<FleetMaintenanceScreen> {
  final BrakePadAnalyticsService _analyticsService = BrakePadAnalyticsService();
  List<BrakePadAnalytics> _brakePads = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  void _loadData() async {
    final data = await _analyticsService.getBrakePadWearAnalytics();
    if (mounted) {
      setState(() {
        _brakePads = data;
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Fleet Maintenance'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('AI Predictive Maintenance', style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  const Text('Telematics-driven brake pad wear prediction based on braking frequency, load weight, and elevation.', style: TextStyle(color: Colors.grey)),
                  const SizedBox(height: 24),
                  const Text('Brake Pad Health Scores', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 16),
                  ..._brakePads.map((pad) => _buildBrakePadCard(pad)),
                ],
              ),
            ),
    );
  }

  Widget _buildBrakePadCard(BrakePadAnalytics pad) {
    Color severityColor;
    switch (pad.wearSeverity) {
      case 'Critical':
        severityColor = Colors.red;
        break;
      case 'High':
        severityColor = Colors.orange;
        break;
      case 'Moderate':
        severityColor = Colors.amber;
        break;
      default:
        severityColor = Colors.green;
    }

    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: pad.wearSeverity == 'Critical' ? Colors.red : Colors.transparent, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(pad.axlePosition, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  decoration: BoxDecoration(
                    color: severityColor.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    pad.wearSeverity.toUpperCase(),
                    style: TextStyle(color: severityColor, fontWeight: FontWeight.bold),
                  ),
                )
              ],
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${pad.estimatedRemainingLifePercent}%', style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: severityColor)),
                      const Text('Est. Remaining Life', style: TextStyle(color: Colors.grey)),
                    ],
                  ),
                ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${pad.estimatedRemainingMiles} mi', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold)),
                      const Text('Est. Remaining Miles', style: TextStyle(color: Colors.grey)),
                    ],
                  ),
                )
              ],
            ),
            const SizedBox(height: 16),
            LinearProgressIndicator(
              value: pad.estimatedRemainingLifePercent / 100,
              backgroundColor: Colors.grey[200],
              color: severityColor,
              minHeight: 8,
              borderRadius: BorderRadius.circular(4),
            ),
            const Divider(height: 32),
            const Text('Contributing Factors:', style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            ...pad.contributingFactors.map((factor) => Row(
              children: [
                const Icon(Icons.arrow_right, color: Colors.grey, size: 20),
                Expanded(child: Text(factor, style: const TextStyle(color: Colors.blueGrey))),
              ],
            )),
            if (pad.wearSeverity == 'Critical') ...[
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: () {},
                  icon: const Icon(Icons.build),
                  label: const Text('SCHEDULE REPLACEMENT NOW'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.red[900],
                    foregroundColor: Colors.white,
                  ),
                ),
              )
            ]
          ],
        ),
      ),
    );
  }
}
