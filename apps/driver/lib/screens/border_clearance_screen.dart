import 'package:flutter/material.dart';
import '../models/border_clearance_model.dart';
import '../services/border_clearance_service.dart';

class BorderClearanceScreen extends StatefulWidget {
  const BorderClearanceScreen({super.key});

  @override
  State<BorderClearanceScreen> createState() => _BorderClearanceScreenState();
}

class _BorderClearanceScreenState extends State<BorderClearanceScreen> {
  final BorderClearanceService _service = BorderClearanceService();
  BorderClearanceSession? _session;

  @override
  void initState() {
    super.initState();
    _service.clearanceStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateBorderCrossing();
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
        title: const Text('Border Smart Contract'),
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
              _buildLocationCard(s),
              const SizedBox(height: 24),
              const Text('CRYPTOGRAPHIC PAYLOADS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              ...s.payloads.map((p) => _buildPayloadCard(p, s.isCleared)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(BorderClearanceSession s) {
    Color headerColor;
    IconData icon;
    
    if (s.isCleared) {
      headerColor = Colors.green[800]!;
      icon = Icons.check_circle;
    } else if (s.distanceToBorderMiles < 1.0) {
      headerColor = Colors.deepPurple[800]!;
      icon = Icons.wifi_tethering;
    } else {
      headerColor = Colors.blueGrey[800]!;
      icon = Icons.location_on;
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
              const Text('ZERO-KNOWLEDGE CLEARANCE', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (!s.isCleared && s.distanceToBorderMiles < 1.0) ...[
            const SizedBox(height: 16),
            const LinearProgressIndicator(color: Colors.white, backgroundColor: Colors.white24),
          ]
        ],
      ),
    );
  }

  Widget _buildLocationCard(BorderClearanceSession s) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Port of Entry', style: TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            Text(s.crossingName, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Distance', style: TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold)),
                    Text('${s.distanceToBorderMiles.toStringAsFixed(1)} mi', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
                  ],
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Text('Bonded Fees (USD)', style: TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold)),
                    Text('\$${s.bondedFeesUsd.toStringAsFixed(2)}', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.green)),
                  ],
                )
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildPayloadCard(CryptographicPayload p, bool isCleared) {
    bool isVerified = p.status == 'Verified' || p.status == 'Executed';
    bool isTransmitting = p.status == 'Transmitting...';

    return Card(
      elevation: isVerified ? 1 : (isTransmitting ? 4 : 1),
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: isVerified ? Colors.green : (isTransmitting ? Colors.deepPurple : Colors.transparent), width: 2),
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
                    Icon(isVerified ? Icons.lock : Icons.lock_outline, color: isVerified ? Colors.green : Colors.blueGrey),
                    const SizedBox(width: 8),
                    Text(p.documentType, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  ],
                ),
                Text(p.status.toUpperCase(), style: TextStyle(color: isVerified ? Colors.green : (isTransmitting ? Colors.deepPurple : Colors.grey), fontWeight: FontWeight.bold, fontSize: 12)),
              ],
            ),
            if (p.hash != '...') ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: Colors.grey[100], borderRadius: BorderRadius.circular(4)),
                child: Row(
                  children: [
                    const Icon(Icons.fingerprint, size: 16, color: Colors.grey),
                    const SizedBox(width: 8),
                    Text('HASH: ${p.hash}', style: const TextStyle(fontFamily: 'monospace', color: Colors.blueGrey, fontSize: 12)),
                  ],
                ),
              )
            ]
          ],
        ),
      ),
    );
  }
}
