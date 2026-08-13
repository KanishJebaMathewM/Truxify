import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/yard_management_model.dart';
import '../services/yard_management_service.dart';

class YardManagementScreen extends StatefulWidget {
  const YardManagementScreen({super.key});

  @override
  State<YardManagementScreen> createState() => _YardManagementScreenState();
}

class _YardManagementScreenState extends State<YardManagementScreen> {
  final YardManagementService _service = YardManagementService();
  YardManagementSession? _session;

  @override
  void initState() {
    super.initState();
    _service.yardStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.initializeYard();
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
        title: const Text('Jockey Yard Management'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _session?.isSyncing == true ? null : () => _service.simulateIncomingDispatchInstruction(),
        backgroundColor: Colors.indigo,
        icon: const Icon(Icons.webhook),
        label: const Text('Simulate Webhook'),
      ),
    );
  }

  Widget _buildDashboard() {
    final s = _session!;

    return Column(
      children: [
        _buildStatusHeader(s),
        Expanded(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                flex: 2,
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    const Text('DISPATCHER INSTRUCTIONS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                    const SizedBox(height: 12),
                    if (s.activeInstructions.isEmpty)
                      const Center(child: Padding(
                        padding: EdgeInsets.all(32.0),
                        child: Text('No active moves. Waiting for dispatch...', style: TextStyle(color: Colors.grey)),
                      ))
                    else
                      ...s.activeInstructions.map((cmd) => _buildInstructionCard(cmd, s.trailers)),
                  ],
                ),
              ),
              Expanded(
                flex: 1,
                child: Container(
                  color: Colors.white,
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('LIVE YARD INVENTORY', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                      const SizedBox(height: 12),
                      Expanded(
                        child: ListView.builder(
                          itemCount: s.trailers.length,
                          itemBuilder: (context, index) {
                            return _buildInventoryRow(s.trailers[index]);
                          },
                        ),
                      )
                    ],
                  ),
                ),
              )
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(YardManagementSession s) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: s.isSyncing ? Colors.indigo[600] : Colors.blueGrey[800],
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              s.isSyncing 
                ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3))
                : const Icon(Icons.warehouse, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('2D YARD GRID ENGINE', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildInstructionCard(YardInstruction cmd, List<YardTrailer> trailers) {
    // Find current location
    YardTrailer target = trailers.firstWhere((t) => t.trailerId == cmd.trailerId);

    return Card(
      elevation: 4,
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(
        side: const BorderSide(color: Colors.indigo, width: 2),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    const Icon(Icons.fire_truck, color: Colors.indigo),
                    const SizedBox(width: 12),
                    Text(cmd.trailerId, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 20)),
                  ],
                ),
                Text(DateFormat('h:mm:ss a').format(cmd.issuedAt), style: const TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold)),
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Current Location', style: TextStyle(color: Colors.grey, fontSize: 12)),
                    Text(target.location, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                  ],
                ),
                const Icon(Icons.arrow_forward, color: Colors.grey),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Text('Target Destination', style: TextStyle(color: Colors.grey, fontSize: 12)),
                    Text(cmd.targetLocation, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: Colors.indigo)),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: () => _service.completeInstruction(cmd.instructionId),
                icon: const Icon(Icons.check_circle),
                label: const Text('Confirm Trailer Moved'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.green,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.all(16),
                ),
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildInventoryRow(YardTrailer t) {
    Color statusColor = Colors.grey;
    if (t.status == 'Loaded') statusColor = Colors.blue;
    if (t.status == 'Maintenance') statusColor = Colors.red;
    
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: BoxDecoration(border: Border(bottom: BorderSide(color: Colors.grey[200]!))),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(t.trailerId, style: const TextStyle(fontWeight: FontWeight.bold)),
              Row(
                children: [
                  Container(
                    width: 8, height: 8,
                    decoration: BoxDecoration(color: statusColor, shape: BoxShape.circle),
                  ),
                  const SizedBox(width: 4),
                  Text(t.status, style: const TextStyle(color: Colors.grey, fontSize: 10)),
                ],
              )
            ],
          ),
          Text(t.location, style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.blueGrey)),
        ],
      ),
    );
  }
}
