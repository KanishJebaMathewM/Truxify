import 'package:flutter/material.dart';
import '../models/freight_bot_model.dart';
import '../services/freight_bot_service.dart';

class FreightBotScreen extends StatefulWidget {
  const FreightBotScreen({super.key});

  @override
  State<FreightBotScreen> createState() => _FreightBotScreenState();
}

class _FreightBotScreenState extends State<FreightBotScreen> {
  final FreightBotService _service = FreightBotService();
  FreightBotSession? _session;

  @override
  void initState() {
    super.initState();
    _service.botStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateNegotiation();
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
        title: const Text('Autonomous Dispatch Bot'),
        backgroundColor: Colors.deepPurple[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final s = _session!;
    bool isSecured = s.securedLoad != null;

    return Column(
      children: [
        _buildStatusHeader(s, isSecured),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildTargetCard(s),
              const SizedBox(height: 24),
              const Text('LIVE NEGOTIATIONS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              if (isSecured)
                _buildSecuredLoadCard(s.securedLoad!)
              else
                ...s.negotiationLog.map((log) => _buildNegotiationLogCard(log)),
              if (!isSecured && s.negotiationLog.isEmpty)
                _buildSearchingCard(),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(FreightBotSession s, bool isSecured) {
    Color headerColor = isSecured ? Colors.green[800]! : Colors.deepPurple[800]!;
    IconData icon = isSecured ? Icons.check_circle : Icons.smart_toy;

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
              const Text('AI FREIGHT BROKER', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (!isSecured) ...[
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildHeaderStat('Active Threads', s.activeNegotiations.toString()),
                _buildHeaderStat('Rejected (Too Low)', s.rejectedOffers.toString()),
              ],
            )
          ]
        ],
      ),
    );
  }

  Widget _buildHeaderStat(String label, String value) {
    return Column(
      children: [
        Text(value, style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold)),
        Text(label, style: const TextStyle(color: Colors.white70, fontSize: 12)),
      ],
    );
  }

  Widget _buildTargetCard(FreightBotSession s) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('DRIVER MINIMUM FLOOR', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                const SizedBox(height: 4),
                const Text('Auto-rejecting all offers below.', style: TextStyle(color: Colors.grey, fontSize: 12)),
              ],
            ),
            Text('\$${s.driverMinimumRatePerMile.toStringAsFixed(2)} / mi', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 24, color: Colors.deepPurple[900])),
          ],
        ),
      ),
    );
  }

  Widget _buildSearchingCard() {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: const Padding(
        padding: EdgeInsets.all(32),
        child: Column(
          children: [
            CircularProgressIndicator(color: Colors.deepPurple),
            SizedBox(height: 16),
            Text('Analyzing DAT Load Board capacity...', style: TextStyle(color: Colors.grey)),
          ],
        ),
      ),
    );
  }

  Widget _buildNegotiationLogCard(LoadOffer offer) {
    bool isCounter = offer.status.contains('Countering');
    Color statColor = isCounter ? Colors.orange[800]! : Colors.red[800]!;
    IconData icon = isCounter ? Icons.swap_horiz : Icons.block;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      elevation: 1,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: Colors.grey[300]!)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(offer.brokerName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(color: statColor.withOpacity(0.1), borderRadius: BorderRadius.circular(8)),
                  child: Row(
                    children: [
                      Icon(icon, color: statColor, size: 16),
                      const SizedBox(width: 4),
                      Text(offer.status, style: TextStyle(color: statColor, fontWeight: FontWeight.bold, fontSize: 12)),
                    ],
                  ),
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
                    Text('${offer.origin} ➔ ${offer.destination}', style: const TextStyle(fontWeight: FontWeight.bold)),
                    Text('${offer.distanceMiles.toInt()} miles', style: const TextStyle(color: Colors.grey, fontSize: 12)),
                  ],
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text('\$${offer.offeredRate.toInt()}', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.grey[800], decoration: isCounter ? TextDecoration.lineThrough : TextDecoration.none)),
                    if (isCounter) Text('AI Counter: \$${offer.targetRate.toInt()}', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.orange[900])),
                  ],
                ),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildSecuredLoadCard(LoadOffer offer) {
    return Card(
      elevation: 8,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Colors.green, width: 2),
      ),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.green[50],
              borderRadius: const BorderRadius.only(topLeft: Radius.circular(16), topRight: Radius.circular(16)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('CONTRACT SECURED', style: TextStyle(color: Colors.green, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
                Icon(Icons.verified, color: Colors.green[700]),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              children: [
                Text(offer.brokerName, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                Text('${offer.origin} ➔ ${offer.destination}', style: TextStyle(color: Colors.grey[800], fontSize: 16)),
                const Divider(height: 32),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    Column(
                      children: [
                        Text('\$${offer.offeredRate.toInt()}', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: Colors.green)),
                        const Text('Total Payout', style: TextStyle(color: Colors.grey)),
                      ],
                    ),
                    Container(height: 40, width: 1, color: Colors.grey[300]),
                    Column(
                      children: [
                        Text(offer.status.replaceAll('Booked ', ''), style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.green[800])),
                        const Text('Rate per Mile', style: TextStyle(color: Colors.grey)),
                      ],
                    ),
                  ],
                ),
              ],
            ),
          )
        ],
      ),
    );
  }
}
