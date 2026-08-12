import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/freight_claims_model.dart';
import '../services/freight_claims_service.dart';

class FreightClaimsScreen extends StatefulWidget {
  const FreightClaimsScreen({super.key});

  @override
  State<FreightClaimsScreen> createState() => _FreightClaimsScreenState();
}

class _FreightClaimsScreenState extends State<FreightClaimsScreen> {
  final FreightClaimsService _service = FreightClaimsService();
  FreightClaimSession? _session;

  @override
  void initState() {
    super.initState();
    _service.forensicsStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateClaimAnalysis();
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
        title: const Text('Cargo Claim Defense AI'),
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
    bool isCleared = s.status.contains('CLEARED');

    return Column(
      children: [
        _buildStatusHeader(s, isCleared),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildClaimCard(s),
              const SizedBox(height: 24),
              const Text('AI IMAGE FORENSICS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              if (s.forensics != null) _buildForensicsGrid(s.forensics!),
              if (isCleared) ...[
                const SizedBox(height: 24),
                _buildLegalSummaryCard(s),
              ]
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(FreightClaimSession s, bool isCleared) {
    Color headerColor = Colors.blueGrey[800]!;
    IconData icon = Icons.policy;
    
    if (isCleared) {
      headerColor = Colors.green[700]!;
      icon = Icons.gavel;
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
              const Text('LEGAL DEFENSE SHIELD', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildClaimCard(FreightClaimSession s) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const Text('DISPUTED CLAIM', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            const SizedBox(height: 12),
            Text('-\$${s.claimAmountDollars.toStringAsFixed(2)}', style: TextStyle(color: Colors.red[800], fontSize: 36, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            Text('Load ID: ${s.loadId}', style: const TextStyle(color: Colors.grey, fontSize: 14)),
            const Divider(height: 32),
            Row(
              children: [
                const Icon(Icons.warning, color: Colors.orange),
                const SizedBox(width: 12),
                Expanded(child: Text(s.claimReason, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold))),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildForensicsGrid(ImageForensics f) {
    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: _buildMetricCard(
                'Metadata',
                f.isMetadataAuthentic ? 'VERIFIED' : 'ALTERED',
                Icons.verified,
                f.isMetadataAuthentic ? Colors.green[700]! : Colors.red,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _buildMetricCard(
                'Load Distribution',
                '${f.loadDistributionScore.toStringAsFixed(1)}/100',
                Icons.balance,
                Colors.blueGrey[800]!,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Card(
          elevation: 2,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('AI SECUREMENT DETECTION', style: TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold)),
                const Divider(),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    _buildSubMetric('${f.securementStrapsDetected}', 'Straps Detected', Icons.linear_scale),
                    _buildSubMetric('${f.loadBarsDetected}', 'Load Bars', Icons.vertical_align_center),
                  ],
                ),
                const Divider(),
                const SizedBox(height: 8),
                Row(
                  children: [
                    const Icon(Icons.location_on, size: 16, color: Colors.grey),
                    const SizedBox(width: 8),
                    Expanded(child: Text(f.gpsLocation, style: const TextStyle(fontSize: 12))),
                  ],
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    const Icon(Icons.access_time, size: 16, color: Colors.grey),
                    const SizedBox(width: 8),
                    Expanded(child: Text(DateFormat('yyyy-MM-dd HH:mm:ss').format(f.captureTimestamp), style: const TextStyle(fontSize: 12))),
                  ],
                )
              ],
            ),
          ),
        )
      ],
    );
  }

  Widget _buildMetricCard(String label, String value, IconData icon, Color color) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Icon(icon, color: color),
            const SizedBox(height: 8),
            Text(value, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: color)),
            const SizedBox(height: 4),
            Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
          ],
        ),
      ),
    );
  }
  
  Widget _buildSubMetric(String value, String label, IconData icon) {
    return Column(
      children: [
        Icon(icon, color: Colors.blueGrey),
        const SizedBox(height: 4),
        Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 20)),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }

  Widget _buildLegalSummaryCard(FreightClaimSession s) {
    return Card(
      elevation: 6,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: BorderSide(color: Colors.green[700]!, width: 2)),
      child: Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(color: Colors.green[50], borderRadius: BorderRadius.circular(16)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.gavel, color: Colors.green[800]),
                const SizedBox(width: 12),
                Text('LEGAL DEFENSE SUMMARY', style: TextStyle(color: Colors.green[900], fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              ],
            ),
            const Divider(height: 24),
            Text(s.legalDefenseSummary, style: const TextStyle(fontSize: 15, height: 1.5, color: Colors.black87)),
            const SizedBox(height: 16),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: Colors.green[800], borderRadius: BorderRadius.circular(8)),
              child: const Text('LIABILITY SHIFTED TO SHIPPER', textAlign: TextAlign.center, style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
            )
          ],
        ),
      ),
    );
  }
}
