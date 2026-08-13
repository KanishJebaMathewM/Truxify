import 'package:flutter/material.dart';
import '../models/pallet_simulator_model.dart';
import '../services/pallet_simulator_service.dart';

class PalletSimulatorScreen extends StatefulWidget {
  const PalletSimulatorScreen({super.key});

  @override
  State<PalletSimulatorScreen> createState() => _PalletSimulatorScreenState();
}

class _PalletSimulatorScreenState extends State<PalletSimulatorScreen> {
  final PalletSimulatorService _service = PalletSimulatorService();
  PalletSimulatorSession? _session;

  @override
  void initState() {
    super.initState();
    _service.simulatorStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.initializeSimulator();
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
        title: const Text('3D Pallet Stacking Simulator'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _session?.isComputing == true ? null : () => _service.run3DBinPackingAlgorithm(),
        backgroundColor: Colors.indigo,
        icon: const Icon(Icons.view_in_ar),
        label: const Text('Run 3D Spatial Algorithm'),
      ),
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
              if (s.simulationResult != null) ...[
                _buildSimulationResult(s.simulationResult!),
                const SizedBox(height: 24),
              ],
              const Text('PENDING FREIGHT INVENTORY', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              ...s.pendingInventory.map((p) => _buildPalletCard(p)),
              const SizedBox(height: 80), // Padding for FAB
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(PalletSimulatorSession s) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: s.isComputing ? Colors.indigo[600] : Colors.blueGrey[800],
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              s.isComputing 
                ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3))
                : const Icon(Icons.widgets, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('3D BIN PACKING ENGINE', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildSimulationResult(BinPackingResult result) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(
        side: const BorderSide(color: Colors.green, width: 2),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.check_circle, color: Colors.green),
                const SizedBox(width: 12),
                Text(result.fitSuccessful ? 'SUCCESSFUL 53\' TRAILER FIT' : 'FIT FAILED - OVER CAPACITY', 
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: result.fitSuccessful ? Colors.green[800] : Colors.red)),
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildMetric('Cubic Vol. Utilized', '${result.totalVolumeUtilizedPercentage}%', Colors.indigo),
                _buildMetric('Linear Feet Used', '${result.linearFeetUsed} ft / 53 ft', Colors.blueGrey),
              ],
            ),
            const SizedBox(height: 24),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: Colors.orange[50], borderRadius: BorderRadius.circular(8), border: Border.all(color: Colors.orange)),
              child: Row(
                children: [
                  const Icon(Icons.warning, color: Colors.orange),
                  const SizedBox(width: 12),
                  Expanded(child: Text(result.warnings, style: TextStyle(color: Colors.orange[900], fontWeight: FontWeight.bold, fontSize: 12))),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Center(
              child: Container(
                width: 200,
                height: 100,
                decoration: BoxDecoration(
                  color: Colors.blueGrey[100],
                  border: Border.all(color: Colors.blueGrey),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.view_in_ar, size: 32, color: Colors.indigo),
                      SizedBox(height: 8),
                      Text('[ 3D Canvas Rendering ]', style: TextStyle(color: Colors.indigo, fontWeight: FontWeight.bold)),
                    ],
                  ),
                ),
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildPalletCard(FreightPallet p) {
    return Card(
      elevation: 1,
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(p.palletId, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                const SizedBox(height: 4),
                Text(p.content, style: const TextStyle(color: Colors.grey, fontSize: 12)),
              ],
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(p.dimensions, style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.indigo)),
                const SizedBox(height: 4),
                Row(
                  children: [
                    if (p.isStackable) const Padding(padding: EdgeInsets.only(right: 8.0), child: Icon(Icons.layers, size: 16, color: Colors.green)),
                    if (p.isFragile) const Icon(Icons.wine_bar, size: 16, color: Colors.red),
                  ],
                )
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildMetric(String label, String value, Color color) {
    return Column(
      children: [
        Text(value, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: color)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }
}
