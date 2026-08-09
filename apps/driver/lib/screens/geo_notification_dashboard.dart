import 'package:flutter/material.dart';
import 'dart:async';
import '../models/customer_notification_model.dart';
import '../services/geo_notification_service.dart';
import 'package:intl/intl.dart';

class GeoNotificationDashboard extends StatefulWidget {
  const GeoNotificationDashboard({super.key});

  @override
  State<GeoNotificationDashboard> createState() => _GeoNotificationDashboardState();
}

class _GeoNotificationDashboardState extends State<GeoNotificationDashboard> {
  final GeoNotificationService _geoService = GeoNotificationService();
  StreamSubscription? _subscription;
  final List<CustomerNotification> _logs = [];
  bool _isJourneyActive = false;

  void _startJourney() {
    setState(() {
      _isJourneyActive = true;
      _logs.clear();
    });

    _subscription = _geoService.simulateApproachJourney().listen((notification) {
      if (mounted) {
        setState(() {
          _logs.insert(0, notification); // Add to top of list
        });
      }
    }, onDone: () {
      if (mounted) {
        setState(() {
          _isJourneyActive = false;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Journey complete. All notifications sent.'))
        );
      }
    });
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Automated Customer Notifications'),
        backgroundColor: Colors.teal[700],
      ),
      backgroundColor: Colors.grey[200],
      body: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(24),
            color: Colors.white,
            width: double.infinity,
            child: Column(
              children: [
                const Text('Cascading Geofence Active', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                const Text('Destination: Amazon Fulfillment Center (IND8)', style: TextStyle(color: Colors.grey)),
                const SizedBox(height: 16),
                _isJourneyActive 
                  ? const CircularProgressIndicator()
                  : ElevatedButton.icon(
                      onPressed: _startJourney,
                      icon: const Icon(Icons.play_arrow),
                      label: const Text('START ROUTE SIMULATION'),
                      style: ElevatedButton.styleFrom(backgroundColor: Colors.teal[700], foregroundColor: Colors.white),
                    )
              ],
            ),
          ),
          const Divider(height: 1),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            width: double.infinity,
            color: Colors.teal[50],
            child: const Text('EVENT LOG', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.teal)),
          ),
          Expanded(
            child: _logs.isEmpty 
                ? const Center(child: Text('No events triggered yet.', style: TextStyle(color: Colors.grey)))
                : ListView.builder(
                    itemCount: _logs.length,
                    itemBuilder: (context, index) {
                      final log = _logs[index];
                      return _buildLogCard(log);
                    },
                  ),
          )
        ],
      ),
    );
  }

  Widget _buildLogCard(CustomerNotification log) {
    final timeFormat = DateFormat('HH:mm:ss');
    
    IconData icon;
    Color color;
    
    switch (log.triggerEvent) {
      case '50_MILES_OUT':
        icon = Icons.looks_two;
        color = Colors.blue;
        break;
      case '10_MILES_OUT':
        icon = Icons.looks_one;
        color = Colors.orange;
        break;
      case 'ARRIVED':
        icon = Icons.check_circle;
        color = Colors.green;
        break;
      default:
        icon = Icons.info;
        color = Colors.grey;
    }

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(backgroundColor: color.withOpacity(0.2), child: Icon(icon, color: color)),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    log.triggerEvent.replaceAll('_', ' '),
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                  ),
                ),
                Text(timeFormat.format(log.triggeredAt), style: const TextStyle(color: Colors.grey)),
              ],
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: Colors.grey[100], borderRadius: BorderRadius.circular(8)),
              width: double.infinity,
              child: Text('"${log.messageBody}"', style: const TextStyle(fontStyle: FontStyle.italic)),
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                Icon(Icons.done_all, size: 16, color: log.status == 'SENT' ? Colors.blue : Colors.grey),
                const SizedBox(width: 4),
                Text('Status: ${log.status}', style: const TextStyle(fontSize: 12, color: Colors.grey)),
              ],
            )
          ],
        ),
      ),
    );
  }
}
