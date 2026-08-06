import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/cross_docking_model.dart';
import '../services/cross_docking_sync_engine.dart';

class CrossDockingDashboard extends StatefulWidget {
  const CrossDockingDashboard({super.key});

  @override
  State<CrossDockingDashboard> createState() => _CrossDockingDashboardState();
}

class _CrossDockingDashboardState extends State<CrossDockingDashboard> {
  final CrossDockingSyncEngine _syncEngine = CrossDockingSyncEngine();
  List<CrossDockingMatch> _matches = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadMatches();
  }

  void _loadMatches() async {
    final matches = await _syncEngine.scanForCrossDockingOpportunities();
    if (mounted) {
      setState(() {
        _matches = matches;
        _isLoading = false;
      });
    }
  }

  void _confirmTransfer(CrossDockingMatch match) async {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const AlertDialog(
        content: Row(
          children: [
            CircularProgressIndicator(),
            SizedBox(width: 16),
            Text('Syncing Warehouse DB...'),
          ],
        ),
      )
    );

    final success = await _syncEngine.confirmFreightTransfer(match.matchId);

    if (mounted && success) {
      Navigator.pop(context); // Close loading dialog
      setState(() {
        _matches.removeWhere((m) => m.matchId == match.matchId);
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Cross-Docking successful for ${match.matchId}'),
          backgroundColor: Colors.green,
        )
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Cross-Docking Sync'),
        backgroundColor: Colors.indigo[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                Container(
                  padding: const EdgeInsets.all(24),
                  width: double.infinity,
                  color: Colors.white,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Live ETA Sync Engine', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 8),
                      const Text('Automatically matching inbound & outbound freight for zero-storage transfer.', style: TextStyle(color: Colors.grey)),
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          _buildStatWidget('Active Matches', _matches.length.toString(), Colors.indigo),
                          const SizedBox(width: 24),
                          _buildStatWidget('Warehouse Savings', '\$1,450', Colors.green),
                        ],
                      )
                    ],
                  ),
                ),
                Expanded(
                  child: _matches.isEmpty
                      ? const Center(child: Text('No active cross-docking matches.'))
                      : ListView.builder(
                          padding: const EdgeInsets.all(16),
                          itemCount: _matches.length,
                          itemBuilder: (context, index) {
                            return _buildMatchCard(_matches[index]);
                          },
                        ),
                )
              ],
            ),
    );
  }

  Widget _buildStatWidget(String label, String value, Color color) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(value, style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: color)),
        Text(label, style: const TextStyle(color: Colors.grey)),
      ],
    );
  }

  Widget _buildMatchCard(CrossDockingMatch match) {
    final timeFormat = DateFormat('h:mm a');
    
    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(match.matchId, style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.grey)),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  decoration: BoxDecoration(
                    color: match.isSynced ? Colors.green[100] : Colors.orange[100],
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    match.isSynced ? 'SYNCED & READY' : 'IN TRANSIT',
                    style: TextStyle(
                      color: match.isSynced ? Colors.green[900] : Colors.orange[900],
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                    ),
                  ),
                )
              ],
            ),
            const SizedBox(height: 16),
            Text(match.freightDescription, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(Icons.access_time, size: 16, color: Colors.grey),
                const SizedBox(width: 8),
                Text('Transfer ETA: ${timeFormat.format(match.estimatedSyncTime)}'),
              ],
            ),
            const Divider(height: 32),
            Row(
              children: [
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(color: Colors.blue[50], borderRadius: BorderRadius.circular(8)),
                    child: Column(
                      children: [
                        const Text('INBOUND', style: TextStyle(color: Colors.blue, fontWeight: FontWeight.bold, fontSize: 12)),
                        const SizedBox(height: 4),
                        Text(match.inboundTruckId, style: const TextStyle(fontWeight: FontWeight.bold)),
                        Text(match.assignedDockInbound, style: const TextStyle(color: Colors.grey)),
                      ],
                    ),
                  ),
                ),
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 12.0),
                  child: Icon(Icons.arrow_forward, color: Colors.grey),
                ),
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(color: Colors.purple[50], borderRadius: BorderRadius.circular(8)),
                    child: Column(
                      children: [
                        const Text('OUTBOUND', style: TextStyle(color: Colors.purple, fontWeight: FontWeight.bold, fontSize: 12)),
                        const SizedBox(height: 4),
                        Text(match.outboundTruckId, style: const TextStyle(fontWeight: FontWeight.bold)),
                        Text(match.assignedDockOutbound, style: const TextStyle(color: Colors.grey)),
                      ],
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            if (match.isSynced)
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () => _confirmTransfer(match),
                  style: ElevatedButton.styleFrom(backgroundColor: Colors.indigo[900], foregroundColor: Colors.white),
                  child: const Text('CONFIRM FORKLIFT TRANSFER'),
                ),
              )
          ],
        ),
      ),
    );
  }
}
