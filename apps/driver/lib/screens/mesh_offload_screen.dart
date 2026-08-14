import 'package:flutter/material.dart';
import '../models/mesh_offload_model.dart';
import '../services/mesh_offload_service.dart';

class MeshOffloadScreen extends StatefulWidget {
  const MeshOffloadScreen({super.key});

  @override
  State<MeshOffloadScreen> createState() => _MeshOffloadScreenState();
}

class _MeshOffloadScreenState extends State<MeshOffloadScreen> {
  final MeshOffloadService _service = MeshOffloadService();
  MeshSession? _session;

  @override
  void initState() {
    super.initState();
    _service.meshStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateMeshOffload();
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
        title: const Text('Mesh Data Offload'),
        backgroundColor: Colors.teal[900],
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
              _buildNetworkCard(s),
              const SizedBox(height: 24),
              const Text('DATA QUEUE', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              ...s.dataQueue.map((item) => _buildQueueItem(item)),
              const SizedBox(height: 24),
              if (s.cellularDataSavedMb > 0) _buildSavingsCard(s.cellularDataSavedMb),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(MeshSession s) {
    bool isComplete = s.status.contains('COMPLETE');
    bool isUploading = s.status.contains('UPLOADING');
    
    Color headerColor;
    IconData icon;
    
    if (isComplete) {
      headerColor = Colors.green[800]!;
      icon = Icons.cloud_done;
    } else if (isUploading) {
      headerColor = Colors.teal[700]!;
      icon = Icons.cloud_upload;
    } else if (s.isConnectedToMesh) {
      headerColor = Colors.orange[800]!;
      icon = Icons.wifi_protected_setup;
    } else {
      headerColor = Colors.blueGrey[800]!;
      icon = Icons.cell_tower;
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
              const Text('DISTRIBUTED MESH NETWORK', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (isUploading) ...[
            const SizedBox(height: 16),
            const LinearProgressIndicator(color: Colors.white, backgroundColor: Colors.white24),
          ]
        ],
      ),
    );
  }

  Widget _buildNetworkCard(MeshSession s) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: s.isConnectedToMesh ? Colors.teal[50] : Colors.blueGrey[50], borderRadius: BorderRadius.circular(12)),
              child: Icon(s.isConnectedToMesh ? Icons.wifi : Icons.cell_tower, color: s.isConnectedToMesh ? Colors.teal[900] : Colors.blueGrey[900], size: 32),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(s.networkName ?? 'Cellular (5G)', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                  Text(s.isConnectedToMesh ? 'Speed: ${s.uploadSpeedMbps} Mbps' : 'Bandwidth Restricted', style: TextStyle(color: s.isConnectedToMesh ? Colors.teal[900] : Colors.blueGrey[900])),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildQueueItem(OffloadData item) {
    return Card(
      elevation: 1,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        leading: Icon(
          item.isUploaded ? Icons.check_circle : Icons.data_usage,
          color: item.isUploaded ? Colors.green : Colors.grey,
        ),
        title: Text(item.dataType, style: TextStyle(fontWeight: item.isUploaded ? FontWeight.normal : FontWeight.bold)),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text('${(item.sizeMb / 1024).toStringAsFixed(2)} GB', style: const TextStyle(fontWeight: FontWeight.bold)),
            Text(item.isUploaded ? 'UPLOADED' : 'QUEUED', style: TextStyle(fontSize: 10, color: item.isUploaded ? Colors.green : Colors.grey)),
          ],
        ),
      ),
    );
  }

  Widget _buildSavingsCard(double savedMb) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: Colors.green[50],
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.green, width: 2),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('COST AVOIDANCE', style: TextStyle(color: Colors.green, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
                SizedBox(height: 4),
                Text('5G Cellular Data Saved', style: TextStyle(color: Colors.grey, fontSize: 12)),
              ],
            ),
            Text('${(savedMb / 1024).toStringAsFixed(1)} GB', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 32, color: Colors.green[800])),
          ],
        ),
      ),
    );
  }
}
