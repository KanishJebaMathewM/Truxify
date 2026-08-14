import 'package:flutter/material.dart';
import '../models/intermodal_sync_model.dart';
import '../services/rail_edi_service.dart';
import 'package:intl/intl.dart';

class IntermodalSyncScreen extends StatefulWidget {
  const IntermodalSyncScreen({super.key});

  @override
  State<IntermodalSyncScreen> createState() => _IntermodalSyncScreenState();
}

class _IntermodalSyncScreenState extends State<IntermodalSyncScreen> {
  final RailEdiService _ediService = RailEdiService();
  RailContainer? _container;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _fetchEdiData();
  }

  void _fetchEdiData() async {
    final data = await _ediService.getContainerStatus('TRHU-884920-1');
    if (mounted) {
      setState(() {
        _container = data;
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Rail/Truck Hand-off Sync'),
        backgroundColor: Colors.indigo[800],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                _buildTrainStatusCard(),
                Expanded(child: _buildRescheduleAction()),
              ],
            ),
    );
  }

  Widget _buildTrainStatusCard() {
    final c = _container!;
    final delayMinutes = c.currentEta.difference(c.originalEta).inMinutes;
    final isDelayed = delayMinutes > 0;

    return Container(
      width: double.infinity,
      color: Colors.white,
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Container ${c.containerId}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 20)),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                decoration: BoxDecoration(color: Colors.blue[50], borderRadius: BorderRadius.circular(12)),
                child: Text(c.railCarrier, style: TextStyle(color: Colors.indigo[800], fontWeight: FontWeight.bold)),
              )
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              const Icon(Icons.train, color: Colors.indigo, size: 32),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Train: ${c.trainId}', style: const TextStyle(fontWeight: FontWeight.bold)),
                    Text('Dest: ${c.terminalName}', style: const TextStyle(color: Colors.grey)),
                  ],
                ),
              )
            ],
          ),
          const Divider(height: 32),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Original ETA', style: TextStyle(color: Colors.grey)),
                  Text(DateFormat('h:mm a').format(c.originalEta), style: const TextStyle(fontSize: 18, decoration: TextDecoration.lineThrough, color: Colors.grey)),
                ],
              ),
              const Icon(Icons.arrow_forward),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  const Text('Live EDI Update', style: TextStyle(color: Colors.orange, fontWeight: FontWeight.bold)),
                  Text(DateFormat('h:mm a').format(c.currentEta), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.red)),
                ],
              )
            ],
          ),
          if (isDelayed) ...[
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: Colors.red[50], borderRadius: BorderRadius.circular(8)),
              child: Row(
                children: [
                  const Icon(Icons.warning, color: Colors.red),
                  const SizedBox(width: 8),
                  Expanded(child: Text(c.delayReason, style: TextStyle(color: Colors.red[900]))),
                ],
              ),
            )
          ]
        ],
      ),
    );
  }

  Widget _buildRescheduleAction() {
    final c = _container!;
    final delayMinutes = c.currentEta.difference(c.originalEta).inMinutes;

    return Padding(
      padding: const EdgeInsets.all(24.0),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.schedule, size: 64, color: Colors.indigo[200]),
          const SizedBox(height: 16),
          Text(
            'Save ${delayMinutes ~/ 60} hours and ${delayMinutes % 60} minutes of detention time.',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          const Text(
            'The train is delayed. Instead of waiting at the rail yard, you can dynamically push back your ramp appointment and take another short load in the meantime.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.grey),
          ),
          const SizedBox(height: 32),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: () {
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Terminal appointment rescheduled.')));
              },
              style: ElevatedButton.styleFrom(backgroundColor: Colors.indigo[800], foregroundColor: Colors.white, padding: const EdgeInsets.all(16)),
              child: const Text('RESCHEDULE RAMP APPOINTMENT', style: TextStyle(fontWeight: FontWeight.bold)),
            ),
          )
        ],
      ),
    );
  }
}
