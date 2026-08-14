import 'package:flutter/material.dart';
import '../models/freight_ledger_model.dart';
import '../services/freight_ledger_service.dart';

class FreightLedgerScreen extends StatefulWidget {
  const FreightLedgerScreen({super.key});

  @override
  State<FreightLedgerScreen> createState() => _FreightLedgerScreenState();
}

class _FreightLedgerScreenState extends State<FreightLedgerScreen> {
  final FreightLedgerService _service = FreightLedgerService();
  FreightLedgerSession? _session;

  @override
  void initState() {
    super.initState();
    _service.ledgerStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateColdChainTransit();
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
        title: const Text('Liability Ledger'),
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
              _buildTemperatureCard(s),
              const SizedBox(height: 24),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('IMMUTABLE BLOCKCHAIN LOG', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                  Text('${s.totalBlocksCommitted} BLOCKS', style: const TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold)),
                ],
              ),
              const SizedBox(height: 12),
              ...s.recentLogs.reversed.map((log) => _buildLogCard(log, s.targetTempF, s.maxAllowedDeviationF)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(FreightLedgerSession s) {
    Color headerColor;
    IconData icon;
    
    if (s.isColdChainBroken) {
      headerColor = Colors.red[900]!;
      icon = Icons.gavel;
    } else if (s.status.contains('COMPLETE')) {
      headerColor = Colors.green[800]!;
      icon = Icons.verified;
    } else {
      headerColor = Colors.blue[900]!;
      icon = Icons.ac_unit;
    }

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
              const Text('CRYPTOGRAPHIC FREIGHT LEDGER', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (!s.status.contains('COMPLETE') && !s.isColdChainBroken) ...[
            const SizedBox(height: 16),
            const LinearProgressIndicator(color: Colors.white, backgroundColor: Colors.white24),
          ]
        ],
      ),
    );
  }

  Widget _buildTemperatureCard(FreightLedgerSession s) {
    double tempDiff = (s.currentTempF - s.targetTempF).abs();
    bool isWarning = tempDiff >= (s.maxAllowedDeviationF * 0.8) && !s.isColdChainBroken;

    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            Row(
              children: [
                const Icon(Icons.inventory, color: Colors.blueGrey),
                const SizedBox(width: 12),
                Text(s.freightType, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Current Temp', style: TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    Text('${s.currentTempF.toStringAsFixed(1)}°', style: TextStyle(fontSize: 48, fontWeight: FontWeight.bold, color: s.isColdChainBroken ? Colors.red : (isWarning ? Colors.orange : Colors.blue))),
                  ],
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Text('Target', style: TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    Text('${s.targetTempF.toStringAsFixed(1)}°', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.grey)),
                    const SizedBox(height: 8),
                    Text('±${s.maxAllowedDeviationF.toStringAsFixed(1)}° Limit', style: const TextStyle(color: Colors.red, fontWeight: FontWeight.bold, fontSize: 12)),
                  ],
                ),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildLogCard(TempLogEntry log, double targetTemp, double maxDeviation) {
    bool isViolation = (log.temperatureF - targetTemp).abs() > maxDeviation;

    return Card(
      elevation: 1,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: isViolation ? Colors.red : Colors.transparent, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    const Icon(Icons.access_time, color: Colors.grey, size: 16),
                    const SizedBox(width: 8),
                    Text('${log.timestamp.hour}:${log.timestamp.minute.toString().padLeft(2, '0')}:${log.timestamp.second.toString().padLeft(2, '0')}', style: const TextStyle(fontWeight: FontWeight.bold)),
                  ],
                ),
                Text('${log.temperatureF.toStringAsFixed(1)}°F', style: TextStyle(color: isViolation ? Colors.red : Colors.blue, fontWeight: FontWeight.bold, fontSize: 18)),
              ],
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(color: Colors.grey[100], borderRadius: BorderRadius.circular(4)),
              child: Row(
                children: [
                  const Icon(Icons.link, size: 16, color: Colors.blueGrey),
                  const SizedBox(width: 8),
                  Text('HASH: ${log.cryptographicHash}', style: const TextStyle(fontFamily: 'monospace', color: Colors.blueGrey, fontSize: 12)),
                ],
              ),
            )
          ],
        ),
      ),
    );
  }
}
