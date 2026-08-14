import 'package:flutter/material.dart';
import '../models/freight_negotiator_model.dart';
import '../services/freight_negotiator_service.dart';

class FreightNegotiatorScreen extends StatefulWidget {
  const FreightNegotiatorScreen({super.key});

  @override
  State<FreightNegotiatorScreen> createState() => _FreightNegotiatorScreenState();
}

class _FreightNegotiatorScreenState extends State<FreightNegotiatorScreen> {
  final FreightNegotiatorService _service = FreightNegotiatorService();
  NegotiationSession? _session;

  @override
  void initState() {
    super.initState();
    _service.negotiationStream.listen((data) {
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
        title: const Text('AI Rate Negotiator'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _service.analyzeLoadPricing(),
        backgroundColor: Colors.indigo,
        icon: const Icon(Icons.analytics),
        label: const Text('Analyze Current Load'),
      ),
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
              if (s.laneData == null)
                const Center(child: Padding(
                  padding: EdgeInsets.all(32.0),
                  child: Text('Tap Analyze to evaluate the broker\'s offer.', style: TextStyle(color: Colors.grey)),
                ))
              else ...[
                _buildMarketDataCard(s.laneData!),
                const SizedBox(height: 16),
                _buildEmailScriptCard(s),
              ]
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(NegotiationSession s) {
    bool isAnalyzing = s.status.contains('Querying') || s.status.contains('Generating');

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: isAnalyzing ? Colors.indigo[600] : Colors.blueGrey[800],
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              isAnalyzing 
                ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3))
                : const Icon(Icons.gavel, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('MARKET PRICING ENGINE', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildMarketDataCard(MarketLaneData data) {
    Color statusColor = data.isLowball ? Colors.red : Colors.green;

    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Row(
              children: [
                const Icon(Icons.route, color: Colors.indigo),
                const SizedBox(width: 12),
                Text('${data.origin} ➔ ${data.destination}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _buildMetric('Broker Offer', '\$${data.brokerInitialOffer.toStringAsFixed(2)}/mi', statusColor),
                _buildMetric('Market Avg', '\$${data.currentMarketAverageRate.toStringAsFixed(2)}/mi', Colors.indigo),
                _buildMetric('7-Day High', '\$${data.sevenDayHigh.toStringAsFixed(2)}/mi', Colors.green),
              ],
            ),
            const SizedBox(height: 24),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: statusColor.withOpacity(0.1), borderRadius: BorderRadius.circular(8)),
              child: Text(
                data.isLowball 
                  ? 'LOWBALL ALERT: Offer is \$${data.variance.toStringAsFixed(2)} below market average.'
                  : 'FAIR MARKET VALUE: Offer aligns with historical data.',
                style: TextStyle(color: statusColor, fontWeight: FontWeight.bold),
                textAlign: TextAlign.center,
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildMetric(String label, String value, Color color) {
    return Column(
      children: [
        Text(value, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 20, color: color)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }

  Widget _buildEmailScriptCard(NegotiationSession s) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: Colors.indigo[100]!, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Row(
                  children: [
                    Icon(Icons.auto_awesome, color: Colors.indigo),
                    SizedBox(width: 8),
                    Text('AI Counter-Offer Script', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.indigo)),
                  ],
                ),
                Text('Target: \$${s.targetCounterOffer.toStringAsFixed(2)}/mi', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.green[700])),
              ],
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: Colors.grey[100], borderRadius: BorderRadius.circular(8)),
              child: Text(s.generatedEmailScript, style: const TextStyle(height: 1.5)),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: () {},
                icon: const Icon(Icons.send),
                label: const Text('Send Counter-Offer via Email'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.indigo,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.all(16),
                ),
              ),
            )
          ],
        ),
      ),
    );
  }
}
