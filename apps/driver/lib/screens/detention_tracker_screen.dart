import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'dart:async';
import '../models/detention_pay_model.dart';
import '../services/geofence_detention_service.dart';

class DetentionTrackerScreen extends StatefulWidget {
  const DetentionTrackerScreen({super.key});

  @override
  State<DetentionTrackerScreen> createState() => _DetentionTrackerScreenState();
}

class _DetentionTrackerScreenState extends State<DetentionTrackerScreen> {
  final GeofenceDetentionService _service = GeofenceDetentionService();
  DetentionSession? _session;
  bool _isLoading = true;
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _loadSession();
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  void _loadSession() async {
    final session = await _service.getCurrentSession();
    if (mounted) {
      setState(() {
        _session = session;
        _isLoading = false;
      });
      // Start ticker to update UI every minute
      _ticker = Timer.periodic(const Duration(minutes: 1), (timer) {
        if (mounted) setState(() {});
      });
    }
  }

  String _formatDuration(Duration d) {
    String twoDigits(int n) => n.toString().padLeft(2, "0");
    String twoDigitMinutes = twoDigits(d.inMinutes.remainder(60));
    return "${twoDigits(d.inHours)}h ${twoDigitMinutes}m";
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Smart Detention Pay'),
        backgroundColor: Colors.deepOrange[800],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final s = _session!;
    final bool isBillable = s.billableDetentionTime.inMinutes > 0;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: Colors.deepOrange[800]!, width: 2),
            ),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.gps_fixed, color: Colors.deepOrange[800]),
                    const SizedBox(width: 8),
                    Text('GEOFENCE ACTIVE', style: TextStyle(color: Colors.deepOrange[800], fontWeight: FontWeight.bold, letterSpacing: 1.5)),
                  ],
                ),
                const SizedBox(height: 16),
                Text(s.facilityName, textAlign: TextAlign.center, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                Text('Arrived: ${DateFormat('h:mm a').format(s.geofenceEntryTime)}', style: const TextStyle(color: Colors.grey)),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: _buildTimeCard('Total Wait Time', _formatDuration(s.totalWaitTime), Colors.blueGrey),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: _buildTimeCard('Billable Time', _formatDuration(s.billableDetentionTime), isBillable ? Colors.green[700]! : Colors.grey),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Card(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: Padding(
              padding: const EdgeInsets.all(24.0),
              child: Column(
                children: [
                  const Text('Accrued Detention Pay', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  Text('\$${s.accruedPay.toStringAsFixed(2)}', style: TextStyle(fontSize: 48, fontWeight: FontWeight.bold, color: Colors.green[800])),
                  const SizedBox(height: 8),
                  Text('Rate: \$${s.hourlyDetentionRate.toStringAsFixed(2)} / hr (After ${s.gracePeriodHours} hr grace period)', style: const TextStyle(color: Colors.grey, fontSize: 12)),
                  const Divider(height: 32),
                  SizedBox(
                    width: double.infinity,
                    height: 50,
                    child: ElevatedButton.icon(
                      onPressed: () {
                         ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Accrued pay will automatically append to invoice upon geofence exit.')));
                      },
                      icon: const Icon(Icons.receipt_long),
                      label: const Text('APPEND TO INVOICE', style: TextStyle(fontWeight: FontWeight.bold)),
                      style: ElevatedButton.styleFrom(backgroundColor: Colors.deepOrange[800], foregroundColor: Colors.white),
                    ),
                  )
                ],
              ),
            ),
          )
        ],
      ),
    );
  }

  Widget _buildTimeCard(String title, String value, Color color) {
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(20.0),
        child: Column(
          children: [
            Text(title, style: const TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            Text(value, style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: color)),
          ],
        ),
      ),
    );
  }
}
