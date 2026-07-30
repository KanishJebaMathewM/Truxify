import 'package:flutter/material.dart';
import '../models/offline_sync_event_model.dart';
import '../services/offline_first_sync_service.dart';

class OfflineSyncDashboard extends StatefulWidget {
  const OfflineSyncDashboard({super.key});

  @override
  State<OfflineSyncDashboard> createState() => _OfflineSyncDashboardState();
}

class _OfflineSyncDashboardState extends State<OfflineSyncDashboard> {
  final OfflineFirstSyncService _syncService = OfflineFirstSyncService();
  bool _isOnline = false;
  List<OfflineSyncEvent> _events = [];

  @override
  void initState() {
    super.initState();
    _syncService.connectionStream.listen((status) {
      if (mounted) setState(() => _isOnline = status);
    });
    _syncService.databaseStream.listen((db) {
      if (mounted) setState(() => _events = db);
    });
  }

  void _simulateDriverAction(String action) {
    _syncService.queueEvent(action, {'timestamp': DateTime.now().toIso8601String()});
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Saved locally: $action'),
        backgroundColor: Colors.blueGrey,
        duration: const Duration(seconds: 1),
      )
    );
  }

  @override
  Widget build(BuildContext context) {
    final pendingCount = _events.where((e) => !e.isSynced).length;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Offline-First Core'),
        backgroundColor: Colors.brown[800],
        actions: [
          Row(
            children: [
              Text(_isOnline ? 'ONLINE' : 'OFFLINE', style: const TextStyle(fontWeight: FontWeight.bold)),
              Switch(
                value: _isOnline,
                activeColor: Colors.greenAccent,
                inactiveThumbColor: Colors.redAccent,
                onChanged: (val) => _syncService.toggleNetwork(val),
              ),
            ],
          )
        ],
      ),
      backgroundColor: Colors.grey[200],
      body: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            color: _isOnline ? Colors.green[100] : Colors.red[100],
            child: Row(
              children: [
                Icon(_isOnline ? Icons.cloud_done : Icons.cloud_off, color: _isOnline ? Colors.green[800] : Colors.red[800]),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    _isOnline ? 'Network Connected - Syncing automatically' : 'Network Lost - Safe to keep working',
                    style: TextStyle(fontWeight: FontWeight.bold, color: _isOnline ? Colors.green[900] : Colors.red[900]),
                  ),
                ),
                if (pendingCount > 0)
                  CircleAvatar(
                    radius: 16,
                    backgroundColor: Colors.orange,
                    child: Text('$pendingCount', style: const TextStyle(color: Colors.white, fontSize: 12)),
                  )
              ],
            ),
          ),
          
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                ElevatedButton.icon(
                  onPressed: () => _simulateDriverAction('STATUS_UPDATE'),
                  icon: const Icon(Icons.local_shipping),
                  label: const Text('UPDATE STATUS'),
                ),
                ElevatedButton.icon(
                  onPressed: () => _simulateDriverAction('POD_UPLOAD'),
                  icon: const Icon(Icons.document_scanner),
                  label: const Text('UPLOAD POD'),
                ),
              ],
            ),
          ),
          
          const Divider(),
          const Padding(
            padding: EdgeInsets.all(8.0),
            child: Text('Local SQLite Event Queue', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.grey)),
          ),
          
          Expanded(
            child: _events.isEmpty
                ? const Center(child: Text('Local database is empty.', style: TextStyle(color: Colors.grey)))
                : ListView.builder(
                    itemCount: _events.length,
                    itemBuilder: (context, index) {
                      // Reverse order to show newest first
                      final event = _events[_events.length - 1 - index];
                      return _buildEventCard(event);
                    },
                  ),
          )
        ],
      ),
    );
  }

  Widget _buildEventCard(OfflineSyncEvent event) {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: ListTile(
        leading: Icon(
          event.eventType == 'STATUS_UPDATE' ? Icons.local_shipping : Icons.document_scanner,
          color: Colors.brown[600],
        ),
        title: Text(event.eventType, style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Text('Queued: ${event.queuedAt.hour}:${event.queuedAt.minute}:${event.queuedAt.second}'),
        trailing: event.isSynced
            ? const Icon(Icons.cloud_done, color: Colors.green)
            : const SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.orange),
              ),
      ),
    );
  }
}
