import 'package:flutter/material.dart';
import '../models/broker_credit_scoring_model.dart';
import '../services/broker_credit_scoring_service.dart';

class BrokerCreditScoringScreen extends StatefulWidget {
  const BrokerCreditScoringScreen({super.key});

  @override
  State<BrokerCreditScoringScreen> createState() => _BrokerCreditScoringScreenState();
}

class _BrokerCreditScoringScreenState extends State<BrokerCreditScoringScreen> {
  final BrokerCreditScoringService _service = BrokerCreditScoringService();
  List<BrokerCreditProfile>? _profiles;

  @override
  void initState() {
    super.initState();
    _loadProfiles();
  }

  void _loadProfiles() async {
    final profiles = await _service.getBrokerProfiles();
    if (mounted) setState(() => _profiles = profiles);
  }

  void _showReportDialog(BrokerCreditProfile profile) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Report Payment'),
        content: Text('Submit an anonymous blockchain ledger entry for ${profile.brokerName}.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('CANCEL')),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(context);
              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Report submitted to ledger.')));
            },
            child: const Text('SUBMIT'),
          )
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Decentralized Broker Credit'),
        backgroundColor: Colors.indigo[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _profiles == null
          ? const Center(child: CircularProgressIndicator())
          : ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: _profiles!.length,
              itemBuilder: (context, index) {
                return _buildBrokerCard(_profiles![index]);
              },
            ),
    );
  }

  Widget _buildBrokerCard(BrokerCreditProfile profile) {
    Color getScoreColor() {
      if (profile.trustScore.contains('A')) return Colors.green;
      if (profile.trustScore.contains('B')) return Colors.amber[700]!;
      return Colors.red;
    }

    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      elevation: profile.isWarningActive ? 8 : 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: profile.isWarningActive ? Colors.red : Colors.transparent, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Row(
              children: [
                Container(
                  width: 64,
                  height: 64,
                  decoration: BoxDecoration(
                    color: getScoreColor().withOpacity(0.1),
                    shape: BoxShape.circle,
                    border: Border.all(color: getScoreColor(), width: 3),
                  ),
                  alignment: Alignment.center,
                  child: Text(profile.trustScore, style: TextStyle(color: getScoreColor(), fontSize: 28, fontWeight: FontWeight.bold)),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(profile.brokerName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                      Text(profile.mcNumber, style: const TextStyle(color: Colors.grey)),
                    ],
                  ),
                ),
              ],
            ),
            if (profile.isWarningActive) ...[
              const SizedBox(height: 16),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: Colors.red[50], borderRadius: BorderRadius.circular(8)),
                child: Row(
                  children: [
                    const Icon(Icons.warning, color: Colors.red),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'HIGH RISK: Recent spike in default reports. Do not haul without upfront payment.',
                        style: TextStyle(color: Colors.red[900], fontWeight: FontWeight.bold),
                      ),
                    ),
                  ],
                ),
              )
            ],
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildMetric('Avg Pay Time', '${profile.averageDaysToPay.toInt()} Days'),
                _buildMetric('Ledger Reports', '${profile.totalReports}'),
                _buildMetric('Defaults', '${profile.defaultReports}', color: profile.defaultReports > 0 ? Colors.red : null),
              ],
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: OutlinedButton.icon(
                onPressed: () => _showReportDialog(profile),
                icon: const Icon(Icons.add_chart),
                label: const Text('SUBMIT ANONYMOUS REPORT'),
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildMetric(String label, String value, {Color? color}) {
    return Column(
      children: [
        Text(value, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: color ?? Colors.black87)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }
}
