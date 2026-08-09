import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/cpap_compliance_sync_model.dart';
import '../services/cpap_compliance_sync_service.dart';

class CpapComplianceSyncScreen extends StatefulWidget {
  const CpapComplianceSyncScreen({super.key});

  @override
  State<CpapComplianceSyncScreen> createState() => _CpapComplianceSyncScreenState();
}

class _CpapComplianceSyncScreenState extends State<CpapComplianceSyncScreen> {
  final CpapComplianceSyncService _service = CpapComplianceSyncService();
  CpapComplianceReport? _report;
  bool _isSyncing = false;
  String _syncStatus = '';

  void _syncData() async {
    setState(() {
      _isSyncing = true;
      _syncStatus = 'Connecting to CPAP over Bluetooth...';
    });
    
    // Simulate multi-step sync
    await Future.delayed(const Duration(seconds: 1));
    if (mounted) setState(() => _syncStatus = 'Downloading therapy logs...');
    
    await Future.delayed(const Duration(seconds: 1));
    if (mounted) setState(() => _syncStatus = 'Correlating with HOS logs...');

    final result = await _service.syncBluetoothData();
    
    if (mounted) {
      setState(() {
        _report = result;
        _isSyncing = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('DOT CPAP Compliance'),
        backgroundColor: Colors.blue[900],
      ),
      backgroundColor: Colors.grey[100],
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_isSyncing) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const CircularProgressIndicator(),
            const SizedBox(height: 24),
            Text(_syncStatus, style: TextStyle(color: Colors.blue[900], fontSize: 18, fontWeight: FontWeight.bold)),
          ],
        ),
      );
    }

    if (_report == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.bluetooth_connected, size: 100, color: Colors.blue[200]),
              const SizedBox(height: 24),
              const Text('Sync Medical Devices', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              const Text('Download nightly usage data directly from your CPAP to generate your DOT compliance report.', textAlign: TextAlign.center, style: TextStyle(color: Colors.grey)),
              const SizedBox(height: 32),
              SizedBox(
                width: double.infinity,
                height: 56,
                child: ElevatedButton.icon(
                  onPressed: _syncData,
                  icon: const Icon(Icons.sync),
                  label: const Text('SYNC CPAP DATA'),
                  style: ElevatedButton.styleFrom(backgroundColor: Colors.blue[800], foregroundColor: Colors.white),
                ),
              )
            ],
          ),
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _buildComplianceSummary(),
        const SizedBox(height: 24),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text('NIGHTLY LOGS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            TextButton.icon(
              onPressed: () {},
              icon: const Icon(Icons.picture_as_pdf),
              label: const Text('GENERATE PDF'),
            )
          ],
        ),
        const SizedBox(height: 8),
        ..._report!.recentLogs.map((log) => _buildLogCard(log)),
      ],
    );
  }

  Widget _buildComplianceSummary() {
    final r = _report!;
    bool isPassing = r.thirtyDayCompliancePct >= 70.0;
    
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('MACHINE', style: TextStyle(color: Colors.grey[600], fontSize: 12, fontWeight: FontWeight.bold)),
                    Text(r.machineName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(color: isPassing ? Colors.green[50] : Colors.red[50], borderRadius: BorderRadius.circular(16)),
                  child: Row(
                    children: [
                      Icon(isPassing ? Icons.check_circle : Icons.warning, color: isPassing ? Colors.green : Colors.red, size: 16),
                      const SizedBox(width: 4),
                      Text(r.complianceStatus.toUpperCase(), style: TextStyle(color: isPassing ? Colors.green : Colors.red, fontWeight: FontWeight.bold)),
                    ],
                  ),
                )
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildSummaryMetric('30-Day Avg', '${r.thirtyDayCompliancePct}%', isPassing ? Colors.green : Colors.red),
                _buildSummaryMetric('DOT Target', '70.0%', Colors.grey[700]!),
              ],
            ),
            const SizedBox(height: 16),
            LinearProgressIndicator(
              value: r.thirtyDayCompliancePct / 100,
              backgroundColor: Colors.grey[200],
              color: isPassing ? Colors.green : Colors.red,
              minHeight: 12,
              borderRadius: BorderRadius.circular(6),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildSummaryMetric(String label, String value, Color color) {
    return Column(
      children: [
        Text(value, style: TextStyle(color: color, fontSize: 28, fontWeight: FontWeight.bold)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
      ],
    );
  }

  Widget _buildLogCard(CpapUsageLog log) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: Icon(
          log.isCompliant ? Icons.nights_stay : Icons.bedtime_off,
          color: log.isCompliant ? Colors.blue : Colors.orange,
        ),
        title: Text(DateFormat('EEEE, MMM d').format(log.date), style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Text('AHI: ${log.ahiEventsPerHr} events/hr'),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text('${log.hoursUsed} hrs', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: log.isCompliant ? Colors.black : Colors.red)),
            Text(log.isCompliant ? 'Compliant' : '< 4 hrs', style: TextStyle(color: log.isCompliant ? Colors.green : Colors.red, fontSize: 12)),
          ],
        ),
      ),
    );
  }
}
