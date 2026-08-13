import 'package:flutter/material.dart';
import '../models/pwa_dispatch_model.dart';
import '../services/pwa_dispatch_service.dart';

class PwaDispatchScreen extends StatefulWidget {
  const PwaDispatchScreen({super.key});

  @override
  State<PwaDispatchScreen> createState() => _PwaDispatchScreenState();
}

class _PwaDispatchScreenState extends State<PwaDispatchScreen> {
  final PwaDispatchService _service = PwaDispatchService();
  PwaDispatchSession? _session;

  @override
  void initState() {
    super.initState();
    _service.pwaStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.initializeBoard();
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
        title: const Text('Fleet Command (Web)'),
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
        if (s.pwaInstallState == 'Prompting') _buildInstallPrompt(),
        if (s.pwaInstallState == 'Installed') _buildPwaStatusHeader(s),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const Text('ACTIVE FLEET', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              ...s.activeFleet.map((truck) => _buildTruckCard(truck)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildInstallPrompt() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: Colors.blue[800],
      child: Column(
        children: [
          const Icon(Icons.install_mobile, color: Colors.white, size: 48),
          const SizedBox(height: 16),
          const Text('Install Dispatch Board App', style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          const Text('Add to your home screen for offline access and push notifications.', textAlign: TextAlign.center, style: TextStyle(color: Colors.white70)),
          const SizedBox(height: 24),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              TextButton(
                onPressed: () => _service.declineInstall(),
                child: const Text('Not Now', style: TextStyle(color: Colors.white70)),
              ),
              const SizedBox(width: 16),
              ElevatedButton(
                onPressed: () => _service.installPwa(),
                style: ElevatedButton.styleFrom(backgroundColor: Colors.white, foregroundColor: Colors.blue[900]),
                child: const Text('Install App'),
              ),
            ],
          )
        ],
      ),
    );
  }

  Widget _buildPwaStatusHeader(PwaDispatchSession s) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      color: Colors.teal[800],
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(s.isOfflineReady ? Icons.wifi_off : Icons.downloading, color: Colors.white),
          const SizedBox(width: 12),
          Text(s.isOfflineReady ? 'APP INSTALLED (OFFLINE READY)' : 'CACHING ASSETS...', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
        ],
      ),
    );
  }

  Widget _buildTruckCard(DispatchTruck t) {
    Color statusColor;
    IconData statusIcon;

    switch (t.status) {
      case 'In Transit':
        statusColor = Colors.blue;
        statusIcon = Icons.local_shipping;
        break;
      case 'Available':
        statusColor = Colors.green;
        statusIcon = Icons.check_circle;
        break;
      default:
        statusColor = Colors.grey;
        statusIcon = Icons.power_off;
    }

    return Card(
      elevation: 2,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        contentPadding: const EdgeInsets.all(16),
        leading: CircleAvatar(
          backgroundColor: statusColor.withOpacity(0.2),
          child: Icon(statusIcon, color: statusColor),
        ),
        title: Text('${t.truckId} - ${t.driverName}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 4),
            Row(
              children: [
                Icon(Icons.location_on, size: 14, color: Colors.blueGrey[400]),
                const SizedBox(width: 4),
                Text(t.location, style: TextStyle(color: Colors.blueGrey[600])),
              ],
            ),
            const SizedBox(height: 4),
            Text(t.status.toUpperCase(), style: TextStyle(color: statusColor, fontWeight: FontWeight.bold, fontSize: 12)),
          ],
        ),
        trailing: Text('\$${t.currentRevenue.toStringAsFixed(0)}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.green)),
      ),
    );
  }
}
