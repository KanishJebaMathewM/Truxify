import 'package:flutter/material.dart';
import '../models/fuel_hedging_model.dart';
import '../services/fuel_hedging_service.dart';

class FuelHedgingScreen extends StatefulWidget {
  const FuelHedgingScreen({super.key});

  @override
  State<FuelHedgingScreen> createState() => _FuelHedgingScreenState();
}

class _FuelHedgingScreenState extends State<FuelHedgingScreen> {
  final FuelHedgingService _service = FuelHedgingService();
  FuelHedgingSession? _session;

  @override
  void initState() {
    super.initState();
    _service.hedgingStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateFuelOptimization();
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
        title: const Text('Algorithmic Fuel Hedging'),
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
    bool isComplete = s.plannedStops.isNotEmpty;

    return Column(
      children: [
        _buildStatusHeader(s, isComplete),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildTelemetryRow(s),
              const SizedBox(height: 24),
              const Text('PURCHASING STRATEGY', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              if (isComplete)
                ...s.plannedStops.map((stop) => _buildFuelStopCard(stop))
              else
                _buildCalculatingCard(),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(FuelHedgingSession s, bool isComplete) {
    Color headerColor = isComplete ? Colors.green[800]! : Colors.blueGrey[800]!;
    IconData icon = isComplete ? Icons.attach_money : Icons.calculate;

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
              const Text('TRIP ARBITRAGE', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (isComplete) ...[
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(12)),
              child: Text('SAVINGS: \$${s.totalTripSavingsUsd.toStringAsFixed(2)}', style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold)),
            )
          ]
        ],
      ),
    );
  }

  Widget _buildTelemetryRow(FuelHedgingSession s) {
    return Row(
      children: [
        Expanded(child: _buildTelemetryCard('Tank Level', '${s.currentFuelLevelGallons.toInt()} gal', Icons.local_gas_station)),
        const SizedBox(width: 12),
        Expanded(child: _buildTelemetryCard('Live MPG', '${s.averageMpg}', Icons.speed)),
      ],
    );
  }

  Widget _buildTelemetryCard(String label, String value, IconData icon) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Icon(icon, color: Colors.blueGrey, size: 24),
            const SizedBox(height: 8),
            Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 20)),
            Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
          ],
        ),
      ),
    );
  }

  Widget _buildCalculatingCard() {
    return Card(
      elevation: 1,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: const Padding(
        padding: EdgeInsets.all(32),
        child: Column(
          children: [
            CircularProgressIndicator(),
            SizedBox(height: 16),
            Text('Cross-referencing state IFTA taxes and pump prices...', style: TextStyle(color: Colors.grey), textAlign: TextAlign.center),
          ],
        ),
      ),
    );
  }

  Widget _buildFuelStopCard(FuelStop stop) {
    Color statColor = stop.isOptimal ? Colors.green : Colors.orange;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      elevation: 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: stop.isOptimal ? Colors.green : Colors.transparent, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(stop.stationName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                      Text(stop.location, style: const TextStyle(color: Colors.grey)),
                    ],
                  ),
                ),
                if (stop.isOptimal)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(color: Colors.green[50], borderRadius: BorderRadius.circular(8)),
                    child: const Text('FILL TANK', style: TextStyle(color: Colors.green, fontWeight: FontWeight.bold, fontSize: 12)),
                  )
                else
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(color: Colors.orange[50], borderRadius: BorderRadius.circular(8)),
                    child: const Text('SPLASH ONLY', style: TextStyle(color: Colors.orange, fontWeight: FontWeight.bold, fontSize: 12)),
                  )
              ],
            ),
            const Divider(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                Column(
                  children: [
                    Text('\$${stop.pricePerGallon.toStringAsFixed(2)}', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: statColor)),
                    const Text('Price / Gal', style: TextStyle(color: Colors.grey, fontSize: 12)),
                  ],
                ),
                Container(height: 40, width: 1, color: Colors.grey[300]),
                Column(
                  children: [
                    Text('${stop.suggestedGallons.toInt()} gal', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: statColor)),
                    Text(stop.isOptimal ? 'Buy Max' : 'Buy Minimum', style: const TextStyle(color: Colors.grey, fontSize: 12)),
                  ],
                ),
              ],
            )
          ],
        ),
      ),
    );
  }
}
