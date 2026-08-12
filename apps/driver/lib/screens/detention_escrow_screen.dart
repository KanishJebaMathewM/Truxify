import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/detention_escrow_model.dart';
import '../services/detention_escrow_service.dart';

class DetentionEscrowScreen extends StatefulWidget {
  const DetentionEscrowScreen({super.key});

  @override
  State<DetentionEscrowScreen> createState() => _DetentionEscrowScreenState();
}

class _DetentionEscrowScreenState extends State<DetentionEscrowScreen> {
  final DetentionEscrowService _service = DetentionEscrowService();
  DetentionEscrowSession? _session;

  @override
  void initState() {
    super.initState();
    _service.escrowStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateDetention();
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
        title: const Text('Smart Detention Escrow'),
        backgroundColor: Colors.purple[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final s = _session!;
    bool isDetention = s.currentDwellMinutes > s.gracePeriodMinutes;

    return Column(
      children: [
        _buildStatusHeader(s, isDetention),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildFacilityCard(s),
              const SizedBox(height: 24),
              const Text('SMART CONTRACT TELEMETRY', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildFinancialCard(s, isDetention),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(DetentionEscrowSession s, bool isDetention) {
    Color headerColor = isDetention ? Colors.red[900]! : Colors.purple[800]!;
    IconData icon = isDetention ? Icons.monetization_on : Icons.access_time;

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
              const Text('GEOFENCE ACTIVE', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          LinearProgressIndicator(
            value: s.currentDwellMinutes > s.gracePeriodMinutes ? 1.0 : (s.currentDwellMinutes / s.gracePeriodMinutes),
            backgroundColor: Colors.white24,
            color: isDetention ? Colors.greenAccent : Colors.white,
            minHeight: 8,
          ),
          const SizedBox(height: 8),
          Text(
            'Dwell Time: ${s.currentDwellMinutes} mins (Grace: ${s.gracePeriodMinutes})',
            style: const TextStyle(color: Colors.white70, fontSize: 12)
          ),
        ],
      ),
    );
  }

  Widget _buildFacilityCard(DetentionEscrowSession s) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const Text('FACILITY LOCATION', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            const SizedBox(height: 12),
            Text(s.facilityName, style: const TextStyle(color: Colors.black87, fontSize: 20, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            Text('Arrival: ${DateFormat('h:mm a').format(s.arrivalTime)}', style: const TextStyle(color: Colors.grey, fontSize: 16)),
          ],
        ),
      ),
    );
  }

  Widget _buildFinancialCard(DetentionEscrowSession s, bool isDetention) {
    return Card(
      elevation: isDetention ? 8 : 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: isDetention ? Colors.green : Colors.transparent, width: 2),
      ),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: isDetention ? Colors.green[50] : Colors.grey[100],
              borderRadius: const BorderRadius.only(topLeft: Radius.circular(16), topRight: Radius.circular(16)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Contract:', style: TextStyle(fontWeight: FontWeight.bold)),
                Text(s.smartContractHash, style: TextStyle(color: Colors.grey[700], fontFamily: 'monospace')),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Rate:', style: TextStyle(fontSize: 16, color: Colors.grey)),
                    Text('\$${s.detentionRatePerHour.toStringAsFixed(2)} / hr', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  ],
                ),
                const Divider(height: 32),
                const Text('PAYMENT ACCRUED', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
                const SizedBox(height: 12),
                Text(
                  '+\$${s.accumulatedDetentionPay.toStringAsFixed(2)}',
                  style: TextStyle(
                    fontSize: 48,
                    fontWeight: FontWeight.bold,
                    color: isDetention ? Colors.green[700] : Colors.black26,
                  ),
                ),
                if (isDetention) ...[
                  const SizedBox(height: 16),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    decoration: BoxDecoration(color: Colors.green[700], borderRadius: BorderRadius.circular(8)),
                    child: const Text('DRAINING BROKER ESCROW...', textAlign: TextAlign.center, style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                  )
                ] else ...[
                   const SizedBox(height: 16),
                   const Text('Waiting for grace period to expire.', style: TextStyle(color: Colors.grey)),
                ]
              ],
            ),
          )
        ],
      ),
    );
  }
}
