import 'package:flutter/material.dart';
import '../models/map_cache_model.dart';
import '../services/map_cache_service.dart';

class MapCacheScreen extends StatefulWidget {
  const MapCacheScreen({super.key});

  @override
  State<MapCacheScreen> createState() => _MapCacheScreenState();
}

class _MapCacheScreenState extends State<MapCacheScreen> {
  final MapCacheService _service = MapCacheService();
  MapCacheSession? _session;

  @override
  void initState() {
    super.initState();
    _service.cacheStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.initializeManager();
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
        title: const Text('Smart Map Cache Manager'),
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
              if (s.activeCorridor == null) ...[
                const SizedBox(height: 100),
                Center(
                  child: ElevatedButton.icon(
                    onPressed: () => _service.acceptLoadAndStartCache(),
                    icon: const Icon(Icons.check_circle),
                    label: const Text('Accept Load: CHI ➔ LA'),
                    style: ElevatedButton.styleFrom(backgroundColor: Colors.indigo, foregroundColor: Colors.white, padding: const EdgeInsets.all(16)),
                  ),
                )
              ] else ...[
                _buildCorridorCard(s.activeCorridor!),
                const SizedBox(height: 16),
                _buildProgressCard(s),
                const SizedBox(height: 32),
                if (s.isCachingComplete)
                  ElevatedButton.icon(
                    onPressed: () => _service.toggleSimulateDeadZone(),
                    icon: Icon(s.isOfflineModeSimulated ? Icons.wifi : Icons.wifi_off),
                    label: Text(s.isOfflineModeSimulated ? 'Restore Network' : 'Simulate Wyoming Dead Zone'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: s.isOfflineModeSimulated ? Colors.green : Colors.red,
                      foregroundColor: Colors.white,
                    ),
                  )
              ]
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(MapCacheSession s) {
    bool isDownloading = s.activeCorridor != null && !s.isCachingComplete;
    bool isOffline = s.isOfflineModeSimulated;

    Color headerColor = Colors.blueGrey[800]!;
    if (isDownloading) headerColor = Colors.blue[800]!;
    if (s.isCachingComplete) headerColor = Colors.green[800]!;
    if (isOffline) headerColor = Colors.red[900]!;

    IconData headerIcon = Icons.storage;
    if (isDownloading) headerIcon = Icons.cloud_download;
    if (s.isCachingComplete) headerIcon = Icons.cloud_done;
    if (isOffline) headerIcon = Icons.signal_cellular_connected_no_internet_4_bar;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: headerColor,
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(headerIcon, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('SMART CACHE ENGINE', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildCorridorCard(RouteCorridor c) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Row(
              children: [
                const Icon(Icons.route, color: Colors.indigo),
                const SizedBox(width: 12),
                Text('${c.origin} ➔ ${c.destination}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildMetric('Corridor Width', '5 Miles'),
                _buildMetric('Estimated Size', '${c.estimatedSizeMb} MB'),
                _buildMetric('Storage Saved', '9.95 GB'), // 10GB vs 50MB
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildMetric(String label, String value) {
    return Column(
      children: [
        Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.indigo)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }

  Widget _buildProgressCard(MapCacheSession s) {
    double progress = s.downloadProgress;
    
    return Card(
      elevation: 1,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: s.isCachingComplete ? Colors.green : Colors.transparent, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Local Vector Tiles', style: TextStyle(fontWeight: FontWeight.bold)),
                Text('${s.tilesDownloaded} / ${s.activeCorridor!.totalTilesRequired}'),
              ],
            ),
            const SizedBox(height: 16),
            LinearProgressIndicator(
              value: progress,
              backgroundColor: Colors.grey[200],
              color: s.isCachingComplete ? Colors.green : Colors.blue,
              minHeight: 12,
              borderRadius: BorderRadius.circular(6),
            ),
            const SizedBox(height: 8),
            Text(
              '${(progress * 100).toStringAsFixed(0)}%',
              style: TextStyle(
                color: s.isCachingComplete ? Colors.green : Colors.blue,
                fontWeight: FontWeight.bold,
              ),
            )
          ],
        ),
      ),
    );
  }
}
