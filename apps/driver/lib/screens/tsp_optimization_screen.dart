import 'package:flutter/material.dart';
import '../models/tsp_optimization_model.dart';
import '../services/tsp_optimization_service.dart';

class TspOptimizationScreen extends StatefulWidget {
  const TspOptimizationScreen({super.key});

  @override
  State<TspOptimizationScreen> createState() => _TspOptimizationScreenState();
}

class _TspOptimizationScreenState extends State<TspOptimizationScreen> {
  final TspOptimizationService _service = TspOptimizationService();
  TspOptimizationSession? _session;

  @override
  void initState() {
    super.initState();
    _service.tspStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.optimizeRoute();
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
        title: const Text('LTL Route Optimization Engine'),
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
              if (s.optimizedTotalMiles > 0) ...[
                _buildSavingsCard(s),
                const SizedBox(height: 24),
              ],
              const Text('OPTIMIZED SEQUENCE', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              if (s.optimizedStops.isEmpty)
                const Center(child: CircularProgressIndicator())
              else
                ...s.optimizedStops.map((stop) => _buildStopCard(stop)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(TspOptimizationSession s) {
    bool isOptimized = s.status.contains('Optimized');

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: isOptimized ? Colors.green[800] : Colors.blueGrey[800],
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(isOptimized ? Icons.check_circle : Icons.alt_route, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('AI TRAVELING SALESPERSON', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildSavingsCard(TspOptimizationSession s) {
    double milesSaved = s.originalTotalMiles - s.optimizedTotalMiles;

    return Card(
      elevation: 4,
      color: Colors.green[50],
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: Colors.green[300]!, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            const Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.savings, color: Colors.green),
                SizedBox(width: 8),
                Text('EFFICIENCY GAINED', style: TextStyle(color: Colors.green, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                Column(
                  children: [
                    Text('${milesSaved.toStringAsFixed(1)}', style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: Colors.green)),
                    const Text('Miles Saved', style: TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold)),
                  ],
                ),
                Container(width: 2, height: 40, color: Colors.green[200]),
                Column(
                  children: [
                    Text('${s.estimatedFuelSavedGallons.toStringAsFixed(1)}', style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: Colors.green)),
                    const Text('Gallons Fuel', style: TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold)),
                  ],
                )
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildStopCard(RouteStop stop) {
    bool isOrigin = stop.optimizedIndex == 1;

    return Card(
      elevation: 1,
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(color: isOrigin ? Colors.blue : Colors.transparent, width: 2),
      ),
      child: ListTile(
        leading: Container(
          width: 32,
          height: 32,
          decoration: BoxDecoration(
            color: isOrigin ? Colors.blue : Colors.grey[300],
            shape: BoxShape.circle,
          ),
          child: Center(
            child: Text(
              '${stop.optimizedIndex}',
              style: TextStyle(color: isOrigin ? Colors.white : Colors.black87, fontWeight: FontWeight.bold),
            ),
          ),
        ),
        title: Text(stop.address, style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Text(stop.contactName),
        trailing: stop.distanceFromPreviousMiles > 0 
          ? Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text('+${stop.distanceFromPreviousMiles} mi', style: const TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold, fontSize: 14)),
                const Text('from prev', style: TextStyle(color: Colors.grey, fontSize: 10)),
              ],
            )
          : const Text('ORIGIN', style: TextStyle(color: Colors.blue, fontWeight: FontWeight.bold, fontSize: 12)),
      ),
    );
  }
}
