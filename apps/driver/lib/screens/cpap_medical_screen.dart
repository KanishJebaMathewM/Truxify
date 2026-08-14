import 'package:flutter/material.dart';
import '../models/cpap_medical_model.dart';
import '../services/cpap_medical_service.dart';

class CpapMedicalScreen extends StatefulWidget {
  const CpapMedicalScreen({super.key});

  @override
  State<CpapMedicalScreen> createState() => _CpapMedicalScreenState();
}

class _CpapMedicalScreenState extends State<CpapMedicalScreen> {
  final CpapMedicalService _service = CpapMedicalService();
  CpapMedicalProfile? _profile;

  @override
  void initState() {
    super.initState();
    _service.profileStream.listen((data) {
      if (mounted) setState(() => _profile = data);
    });
    _service.simulateCpapSync();
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
        title: const Text('DOT CPAP Compliance'),
        backgroundColor: Colors.teal[900],
      ),
      backgroundColor: Colors.grey[100],
      body: _profile == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final p = _profile!;

    return Column(
      children: [
        _buildStatusHeader(p),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildComplianceCard(p),
              const SizedBox(height: 24),
              const Text('RECENT SLEEP SESSIONS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              if (p.recentSessions.isEmpty)
                const Center(child: CircularProgressIndicator())
              else
                ...p.recentSessions.map((s) => _buildSessionCard(s)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(CpapMedicalProfile p) {
    Color headerColor = p.isDotCompliant ? Colors.teal[800]! : Colors.blueGrey[800]!;
    IconData icon = p.isDotCompliant ? Icons.verified : Icons.bluetooth_searching;

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
              const Text('MEDICAL TELEMETRY', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(p.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (p.certificateHash != null) ...[
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(8)),
              child: Text('FMCSA HASH: ${p.certificateHash}', style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold, fontFamily: 'monospace')),
            )
          ] else ...[
            const SizedBox(height: 16),
            const LinearProgressIndicator(color: Colors.white, backgroundColor: Colors.white24),
          ]
        ],
      ),
    );
  }

  Widget _buildComplianceCard(CpapMedicalProfile p) {
    bool isPassing = p.compliancePercentage30Days >= 70.0;
    
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('30-Day DOT Compliance', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.blueGrey, fontSize: 16)),
                Text('${p.compliancePercentage30Days.toStringAsFixed(1)}%', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 24, color: isPassing ? Colors.teal : Colors.orange)),
              ],
            ),
            const SizedBox(height: 12),
            LinearProgressIndicator(
              value: p.compliancePercentage30Days / 100.0,
              backgroundColor: Colors.grey[200],
              color: isPassing ? Colors.teal : Colors.orange,
              minHeight: 12,
              borderRadius: BorderRadius.circular(6),
            ),
            const SizedBox(height: 8),
            const Align(
              alignment: Alignment.centerRight,
              child: Text('Federal Requirement: 70%', style: TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold)),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildSessionCard(SleepSessionData s) {
    return Card(
      elevation: s.isCompliant ? 1 : 4,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: s.isCompliant ? Colors.transparent : Colors.red, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(s.isCompliant ? Icons.nights_stay : Icons.warning_amber_rounded, color: s.isCompliant ? Colors.indigo : Colors.red),
                    const SizedBox(width: 8),
                    Text('${s.durationHours.toStringAsFixed(1)} Hours', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  ],
                ),
                const SizedBox(height: 4),
                Text('${s.date.month}/${s.date.day}/${s.date.year}', style: const TextStyle(color: Colors.grey, fontSize: 12)),
              ],
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text('AHI: ${s.ahiScore.toStringAsFixed(1)}', style: TextStyle(fontWeight: FontWeight.bold, color: s.ahiScore < 5.0 ? Colors.teal : Colors.red)),
                const SizedBox(height: 4),
                Text('Leak: ${s.maskLeakLitersPerMin.toStringAsFixed(1)} L/min', style: const TextStyle(color: Colors.blueGrey, fontSize: 12)),
              ],
            )
          ],
        ),
      ),
    );
  }
}
