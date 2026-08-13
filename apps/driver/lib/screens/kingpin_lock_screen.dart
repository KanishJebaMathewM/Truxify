import 'package:flutter/material.dart';
import '../models/kingpin_lock_model.dart';
import '../services/kingpin_lock_service.dart';

class KingpinLockScreen extends StatefulWidget {
  const KingpinLockScreen({super.key});

  @override
  State<KingpinLockScreen> createState() => _KingpinLockScreenState();
}

class _KingpinLockScreenState extends State<KingpinLockScreen> {
  final KingpinLockService _service = KingpinLockService();
  KingpinSession? _session;

  @override
  void initState() {
    super.initState();
    _service.lockStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateCouplingProcess();
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
        title: const Text('Digital Fifth-Wheel AI'),
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
              _buildSensorGrid(s.jaws),
              const SizedBox(height: 24),
              const Text('SAFETY PROTOCOLS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildProtocolCard('Autonomous Tug Test', s.isTugTestActive ? 'IN PROGRESS' : (s.blockchainVerificationHash != null ? 'PASSED' : 'PENDING'), Icons.compare_arrows, s.isTugTestActive ? Colors.orange : (s.blockchainVerificationHash != null ? Colors.green : Colors.grey)),
              const SizedBox(height: 8),
              _buildProtocolCard('Transmission Lockout', s.isTransmissionLocked ? 'ENGAGED' : 'RELEASED', Icons.lock, s.isTransmissionLocked ? Colors.red : Colors.green),
              if (s.blockchainVerificationHash != null) ...[
                const SizedBox(height: 24),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: Colors.green[50], borderRadius: BorderRadius.circular(12), border: Border.all(color: Colors.green, width: 2)),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('BLOCKCHAIN LEDGER HASH', style: TextStyle(color: Colors.green[900], fontSize: 12, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 4),
                      Text(s.blockchainVerificationHash!, style: const TextStyle(fontWeight: FontWeight.bold, fontFamily: 'monospace')),
                    ],
                  ),
                )
              ]
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(KingpinSession s) {
    Color headerColor;
    IconData icon;
    
    if (s.isTugTestActive) {
      headerColor = Colors.orange[800]!;
      icon = Icons.sync;
    } else if (s.jaws.isFullyLocked && !s.isTransmissionLocked) {
      headerColor = Colors.green[800]!;
      icon = Icons.verified_user;
    } else {
      headerColor = Colors.blueGrey[800]!;
      icon = Icons.link_off;
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
              const Text('COUPLING VERIFICATION', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (s.isTugTestActive) ...[
            const SizedBox(height: 16),
            const LinearProgressIndicator(color: Colors.white, backgroundColor: Colors.white24),
          ]
        ],
      ),
    );
  }

  Widget _buildSensorGrid(JawsStatus jaws) {
    return Row(
      children: [
        Expanded(child: _buildSensorTile('Left Jaw', jaws.isLeftJawLocked)),
        const SizedBox(width: 8),
        Expanded(child: _buildSensorTile('Right Jaw', jaws.isRightJawLocked)),
        const SizedBox(width: 8),
        Expanded(child: _buildSensorTile('Release Handle', jaws.isReleaseHandleSecured)),
      ],
    );
  }

  Widget _buildSensorTile(String label, bool isSecure) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: isSecure ? Colors.green : Colors.red, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 8),
        child: Column(
          children: [
            Icon(isSecure ? Icons.lock : Icons.lock_open, color: isSecure ? Colors.green : Colors.red, size: 32),
            const SizedBox(height: 12),
            Text(label, textAlign: TextAlign.center, style: TextStyle(color: Colors.blueGrey[900], fontWeight: FontWeight.bold, fontSize: 12)),
            const SizedBox(height: 4),
            Text(isSecure ? 'SECURE' : 'OPEN', style: TextStyle(color: isSecure ? Colors.green : Colors.red, fontWeight: FontWeight.bold, fontSize: 12)),
          ],
        ),
      ),
    );
  }

  Widget _buildProtocolCard(String title, String status, IconData icon, Color color) {
    return Card(
      elevation: 1,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        leading: Icon(icon, color: color),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.bold)),
        trailing: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(color: color.withOpacity(0.1), borderRadius: BorderRadius.circular(8)),
          child: Text(status, style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 12)),
        ),
      ),
    );
  }
}
