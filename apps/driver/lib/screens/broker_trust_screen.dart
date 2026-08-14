import 'package:flutter/material.dart';
import '../models/broker_trust_model.dart';
import '../services/broker_trust_service.dart';

class BrokerTrustScreen extends StatefulWidget {
  const BrokerTrustScreen({super.key});

  @override
  State<BrokerTrustScreen> createState() => _BrokerTrustScreenState();
}

class _BrokerTrustScreenState extends State<BrokerTrustScreen> {
  final BrokerTrustService _service = BrokerTrustService();
  BrokerTrustSession? _session;

  @override
  void initState() {
    super.initState();
    _service.trustStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.analyzeBrokers();
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
        title: const Text('Broker Trust Intelligence'),
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
              const Text('BROKER MARKETPLACE', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              if (s.analyzedBrokers.isEmpty)
                const Center(child: CircularProgressIndicator())
              else
                ...s.analyzedBrokers.map((broker) => _buildBrokerCard(broker)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(BrokerTrustSession s) {
    bool isComplete = s.status.contains('Generated');

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: isComplete ? Colors.teal[800] : Colors.blueGrey[800],
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(isComplete ? Icons.verified_user : Icons.analytics, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('DATA AGGREGATOR', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildBrokerCard(BrokerProfile b) {
    bool isHighRisk = b.trustScore < 50;
    bool isLowRisk = b.trustScore > 85;

    Color scoreColor = isHighRisk ? Colors.red : (isLowRisk ? Colors.green : Colors.orange);
    IconData riskIcon = isHighRisk ? Icons.gavel : (isLowRisk ? Icons.verified : Icons.help_outline);

    return Card(
      elevation: isHighRisk ? 6 : 2,
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: scoreColor, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(b.companyName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 20)),
                      const SizedBox(height: 4),
                      Text('MC: ${b.mcNumber}', style: const TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold)),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: scoreColor.withOpacity(0.1), shape: BoxShape.circle),
                  child: Text('${b.trustScore}', style: TextStyle(color: scoreColor, fontSize: 28, fontWeight: FontWeight.bold)),
                )
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildStatMetric('Avg Pay Time', '${b.averageDaysToPay} Days', b.averageDaysToPay > 45),
                _buildStatMetric('Cancel Rate', '${b.cancellationRatePercent}%', b.cancellationRatePercent > 10.0),
                _buildStatMetric('Total Loads', '${b.totalLoadsBrokered}', false),
              ],
            ),
            const SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(riskIcon, color: scoreColor, size: 20),
                const SizedBox(width: 8),
                Text(b.riskCategory.toUpperCase(), style: TextStyle(color: scoreColor, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildStatMetric(String label, String value, bool isBad) {
    return Column(
      children: [
        Text(value, style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: isBad ? Colors.red : Colors.black87)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }
}
