import 'package:flutter/material.dart';
import '../models/broker_score_model.dart';
import '../services/broker_reliability_service.dart';

class BrokerScorecardScreen extends StatefulWidget {
  final String brokerId;
  const BrokerScorecardScreen({super.key, required this.brokerId});

  @override
  State<BrokerScorecardScreen> createState() => _BrokerScorecardScreenState();
}

class _BrokerScorecardScreenState extends State<BrokerScorecardScreen> {
  final BrokerReliabilityService _brokerService = BrokerReliabilityService();
  BrokerReliabilityScore? _score;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadScore();
  }

  void _loadScore() async {
    final score = await _brokerService.getBrokerScore(widget.brokerId);
    if (mounted) {
      setState(() {
        _score = score;
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Broker Reliability Report'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  _buildHeaderCard(),
                  const SizedBox(height: 16),
                  _buildMetricsGrid(),
                  const SizedBox(height: 16),
                  _buildReviewsList(),
                ],
              ),
            ),
    );
  }

  Widget _buildHeaderCard() {
    final s = _score!;
    final bool isGood = s.overallScore >= 80;
    final bool isBad = s.overallScore < 50;
    
    Color badgeColor = isGood ? Colors.green : (isBad ? Colors.red : Colors.orange);

    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(s.brokerName, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
                      Text('Broker ID: ${s.brokerId}', style: const TextStyle(color: Colors.grey)),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: badgeColor, shape: BoxShape.circle),
                  child: Text('${s.overallScore}', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.white)),
                )
              ],
            ),
            const SizedBox(height: 24),
            Row(
              children: [
                Icon(
                  s.isFactoringApproved ? Icons.verified_user : Icons.gpp_bad, 
                  color: s.isFactoringApproved ? Colors.green : Colors.red
                ),
                const SizedBox(width: 8),
                Text(
                  s.isFactoringApproved ? 'Approved by Major Factoring Companies' : 'HIGH RISK: Factoring Companies Deny Invoices',
                  style: TextStyle(fontWeight: FontWeight.bold, color: s.isFactoringApproved ? Colors.green[800] : Colors.red[800]),
                ),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildMetricsGrid() {
    final s = _score!;
    return Row(
      children: [
        Expanded(child: _buildMetricBox('Avg Days to Pay', '${s.averageDaysToPay}', 'Days', s.averageDaysToPay < 30 ? Colors.green : Colors.red)),
        const SizedBox(width: 16),
        Expanded(child: _buildMetricBox('Load Cancel Rate', '${s.loadCancellationRate}', '%', s.loadCancellationRate < 5.0 ? Colors.green : Colors.red)),
      ],
    );
  }

  Widget _buildMetricBox(String title, String value, String unit, Color color) {
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(20.0),
        child: Column(
          children: [
            Text(title, style: const TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold), textAlign: TextAlign.center),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(value, style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: color)),
                const SizedBox(width: 4),
                Padding(
                  padding: const EdgeInsets.only(bottom: 6.0),
                  child: Text(unit, style: const TextStyle(color: Colors.grey)),
                ),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildReviewsList() {
    final s = _score!;
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(20.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Recent Driver Reviews', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                Row(
                  children: [
                    const Icon(Icons.star, color: Colors.amber, size: 20),
                    Text('${s.driverRating} / 5.0', style: const TextStyle(fontWeight: FontWeight.bold)),
                  ],
                )
              ],
            ),
            const Divider(height: 24),
            ...s.recentReviews.map((review) => Padding(
              padding: const EdgeInsets.only(bottom: 12.0),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.format_quote, color: Colors.grey[400]),
                  const SizedBox(width: 8),
                  Expanded(child: Text(review, style: TextStyle(fontStyle: FontStyle.italic, color: Colors.grey[800]))),
                ],
              ),
            )).toList(),
          ],
        ),
      ),
    );
  }
}
