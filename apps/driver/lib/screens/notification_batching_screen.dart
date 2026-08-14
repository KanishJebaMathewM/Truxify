import 'package:flutter/material.dart';
import '../models/notification_batching_model.dart';
import '../services/notification_batching_service.dart';

class NotificationBatchingScreen extends StatefulWidget {
  const NotificationBatchingScreen({super.key});

  @override
  State<NotificationBatchingScreen> createState() => _NotificationBatchingScreenState();
}

class _NotificationBatchingScreenState extends State<NotificationBatchingScreen> {
  final NotificationBatchingService _service = NotificationBatchingService();
  NotificationBatchingSession? _session;

  @override
  void initState() {
    super.initState();
    _service.notificationStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.startSimulation();
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
        title: const Text('Context-Aware Alerts'),
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
    bool isDriving = s.currentSpeedMph > 0;

    return Column(
      children: [
        _buildHudHeader(s, isDriving),
        _buildSpeedControls(s, isDriving),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (s.batchedQueue.isNotEmpty) ...[
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('SILENT BATCH QUEUE', style: TextStyle(color: Colors.orange, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                    Icon(Icons.notifications_paused, color: Colors.orange[800], size: 20),
                  ],
                ),
                const SizedBox(height: 12),
                ...s.batchedQueue.map((n) => _buildNotificationCard(n, isBatched: true)),
                const SizedBox(height: 24),
              ],
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('DELIVERED NOTIFICATIONS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                  Icon(Icons.notifications_active, color: Colors.grey[600], size: 20),
                ],
              ),
              const SizedBox(height: 12),
              if (s.deliveredNotifications.isEmpty)
                const Center(child: Padding(
                  padding: EdgeInsets.all(32.0),
                  child: Text('No active alerts.', style: TextStyle(color: Colors.grey)),
                ))
              else
                ...s.deliveredNotifications.map((n) => _buildNotificationCard(n, isBatched: false)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildHudHeader(NotificationBatchingSession s, bool isDriving) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: isDriving ? Colors.blue[900] : Colors.green[800],
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(isDriving ? Icons.speed : Icons.local_parking, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              Text(
                isDriving ? 'VEHICLE IN MOTION' : 'VEHICLE STOPPED',
                style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            isDriving ? '${s.currentSpeedMph.toStringAsFixed(0)} MPH' : '0 MPH',
            style: const TextStyle(color: Colors.white, fontSize: 36, fontWeight: FontWeight.bold)
          ),
          const SizedBox(height: 8),
          Text(
            isDriving ? 'Blocking non-urgent distractions' : 'Releasing batched notifications',
            style: const TextStyle(color: Colors.white70)
          ),
        ],
      ),
    );
  }

  Widget _buildSpeedControls(NotificationBatchingSession s, bool isDriving) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      color: Colors.white,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          ElevatedButton(
            onPressed: isDriving ? () => _service.toggleSpeed(0.0) : null,
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            child: const Text('Simulate Stop'),
          ),
          ElevatedButton(
            onPressed: !isDriving ? () => _service.toggleSpeed(65.0) : null,
            style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
            child: const Text('Simulate Drive'),
          ),
        ],
      ),
    );
  }

  Widget _buildNotificationCard(ContextNotification n, {required bool isBatched}) {
    Color cardColor = isBatched ? Colors.orange[50]! : (n.isUrgent ? Colors.red[50]! : Colors.white);
    Color iconColor = isBatched ? Colors.orange : (n.isUrgent ? Colors.red : Colors.blueGrey);
    IconData icon = isBatched ? Icons.schedule : (n.isUrgent ? Icons.warning : Icons.info);

    return Card(
      elevation: 1,
      margin: const EdgeInsets.only(bottom: 8),
      color: cardColor,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: n.isUrgent && !isBatched ? Colors.red[300]! : Colors.transparent),
      ),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: iconColor.withOpacity(0.2),
          child: Icon(icon, color: iconColor),
        ),
        title: Text(n.title, style: TextStyle(fontWeight: FontWeight.bold, color: n.isUrgent && !isBatched ? Colors.red[900] : Colors.black87)),
        subtitle: Text(n.message),
        trailing: isBatched 
          ? const Text('HOLD', style: TextStyle(color: Colors.orange, fontWeight: FontWeight.bold))
          : Text(n.isUrgent ? 'BYPASS' : 'DELIVERED', style: TextStyle(color: Colors.grey[500], fontSize: 10, fontWeight: FontWeight.bold)),
      ),
    );
  }
}
