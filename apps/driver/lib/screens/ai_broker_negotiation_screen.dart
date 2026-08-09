import 'package:flutter/material.dart';
import '../models/ai_broker_negotiation_model.dart';
import '../services/ai_broker_negotiation_service.dart';

class AIBrokerNegotiationScreen extends StatefulWidget {
  const AIBrokerNegotiationScreen({super.key});

  @override
  State<AIBrokerNegotiationScreen> createState() => _AIBrokerNegotiationScreenState();
}

class _AIBrokerNegotiationScreenState extends State<AIBrokerNegotiationScreen> {
  final AIBrokerNegotiationService _service = AIBrokerNegotiationService();
  NegotiationSession? _session;
  bool _isBotActive = false;

  @override
  void initState() {
    super.initState();
    _service.negotiationStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
  }

  @override
  void dispose() {
    _service.dispose();
    super.dispose();
  }
  
  void _deployBot() {
    setState(() => _isBotActive = true);
    _service.startNegotiationBot();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AI Auto-Negotiator'),
        backgroundColor: Colors.deepPurple[900],
      ),
      backgroundColor: Colors.grey[200],
      body: !_isBotActive
          ? _buildSetupState()
          : (_session == null ? const Center(child: CircularProgressIndicator()) : _buildNegotiationDashboard()),
    );
  }

  Widget _buildSetupState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.smart_toy, size: 80, color: Colors.deepPurple[400]),
            const SizedBox(height: 24),
            const Text('Automate Broker Hags', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            const Text('Set your minimum rate and let the AI bot email the broker with data-backed counter offers while you drive.', textAlign: TextAlign.center, style: TextStyle(color: Colors.grey)),
            const SizedBox(height: 32),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
              child: const Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Target Lane:', style: TextStyle(fontWeight: FontWeight.bold)),
                  Text('Chicago -> Dallas'),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
              child: const Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Your Absolute Minimum:', style: TextStyle(fontWeight: FontWeight.bold)),
                  Text('\$2,200', style: TextStyle(color: Colors.deepPurple, fontWeight: FontWeight.bold, fontSize: 18)),
                ],
              ),
            ),
            const SizedBox(height: 48),
            SizedBox(
              width: double.infinity,
              height: 56,
              child: ElevatedButton.icon(
                onPressed: _deployBot,
                icon: const Icon(Icons.send),
                label: const Text('DEPLOY BOT'),
                style: ElevatedButton.styleFrom(backgroundColor: Colors.deepPurple[800], foregroundColor: Colors.white),
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildNegotiationDashboard() {
    final s = _session!;
    Color statusColor = Colors.orange;
    if (s.status == 'Accepted') statusColor = Colors.green;
    if (s.status == 'Rejected') statusColor = Colors.red;

    return Column(
      children: [
        Container(
          padding: const EdgeInsets.all(24),
          color: Colors.white,
          child: Column(
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(s.brokerName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                    decoration: BoxDecoration(color: statusColor.withOpacity(0.1), borderRadius: BorderRadius.circular(12)),
                    child: Text(s.status.toUpperCase(), style: TextStyle(color: statusColor, fontWeight: FontWeight.bold)),
                  )
                ],
              ),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  _buildMetric('Driver Min', '\$${s.driverMinimumUsd.toInt()}'),
                  _buildMetric('Broker Initial', '\$${s.initialBrokerOfferUsd.toInt()}'),
                  _buildMetric('Current Offer', '\$${s.history.first.offerAmountUsd?.toInt() ?? 0}', color: Colors.deepPurple),
                ],
              )
            ],
          ),
        ),
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.all(16),
            reverse: true,
            itemCount: s.history.length,
            itemBuilder: (context, index) {
              final msg = s.history[index];
              final isBot = msg.sender == 'AI Bot';
              
              return Align(
                alignment: isBot ? Alignment.centerRight : Alignment.centerLeft,
                child: Container(
                  margin: const EdgeInsets.only(bottom: 12),
                  padding: const EdgeInsets.all(16),
                  constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
                  decoration: BoxDecoration(
                    color: isBot ? Colors.deepPurple[800] : Colors.white,
                    borderRadius: BorderRadius.circular(16).copyWith(
                      bottomRight: isBot ? const Radius.circular(0) : const Radius.circular(16),
                      bottomLeft: !isBot ? const Radius.circular(0) : const Radius.circular(16),
                    ),
                    boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 4, offset: Offset(0, 2))],
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(isBot ? Icons.smart_toy : Icons.person, size: 14, color: isBot ? Colors.white70 : Colors.grey),
                          const SizedBox(width: 4),
                          Text(msg.sender, style: TextStyle(color: isBot ? Colors.white70 : Colors.grey, fontSize: 12, fontWeight: FontWeight.bold)),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(msg.text, style: TextStyle(color: isBot ? Colors.white : Colors.black87)),
                      if (msg.offerAmountUsd != null) ...[
                        const SizedBox(height: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                          decoration: BoxDecoration(color: isBot ? Colors.white24 : Colors.grey[200], borderRadius: BorderRadius.circular(8)),
                          child: Text('\$${msg.offerAmountUsd!.toInt()}', style: TextStyle(color: isBot ? Colors.white : Colors.black, fontWeight: FontWeight.bold)),
                        )
                      ]
                    ],
                  ),
                ),
              );
            },
          ),
        )
      ],
    );
  }

  Widget _buildMetric(String label, String value, {Color? color}) {
    return Column(
      children: [
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
        const SizedBox(height: 4),
        Text(value, style: TextStyle(color: color ?? Colors.black87, fontSize: 18, fontWeight: FontWeight.bold)),
      ],
    );
  }
}
