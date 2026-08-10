import 'package:flutter/material.dart';
import '../models/ev_optimizer_model.dart';
import '../services/ev_optimizer_service.dart';

class EvOptimizerScreen extends StatefulWidget {
  const EvOptimizerScreen({super.key});

  @override
  State<EvOptimizerScreen> createState() => _EvOptimizerScreenState();
}

class _EvOptimizerScreenState extends State<EvOptimizerScreen> {
  final EvOptimizerService _service = EvOptimizerService();
  EvRoutingSession? _session;

  @override
  void initState() {
    super.initState();
    _service.routingStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateEvRouting();
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
        title: const Text('EV Fleet Range Optimizer'),
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
              _buildTelemetryGrid(s),
              const SizedBox(height: 24),
              const Text('INFRASTRUCTURE ROUTING', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              if (s.nextCharger != null)
                _buildChargerCard(s.nextCharger!)
              else
                _buildSearchingCard(s),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(EvRoutingSession s) {
    Color headerColor = Colors.teal[700]!;
    IconData icon = Icons.battery_charging_full;
    
    if (s.status.contains('High Burn')) {
      headerColor = Colors.orange[800]!;
      icon = Icons.battery_alert;
    } else if (s.status.contains('RESERVED')) {
      headerColor = Colors.green[800]!;
      icon = Icons.ev_station;
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
              const Text('AI RANGE CALCULATOR', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 24),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildTelemetryGrid(EvRoutingSession s) {
    return Row(
      children: [
        Expanded(
          child: Card(
            elevation: 2,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                children: [
                  Icon(Icons.electric_car, color: Colors.teal[900], size: 32),
                  const SizedBox(height: 12),
                  Text('${s.currentSocPct}%', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 32, color: s.currentSocPct < 20 ? Colors.red : Colors.black87)),
                  const Text('Battery SoC', style: TextStyle(color: Colors.grey, fontSize: 12)),
                  const Divider(height: 24),
                  Text('${s.projectedRangeMiles.toInt()} mi', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 20, color: Colors.blueGrey)),
                  const Text('Projected Range', style: TextStyle(color: Colors.grey, fontSize: 12)),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Card(
            elevation: 2,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                children: [
                  Icon(Icons.fitness_center, color: Colors.brown[600], size: 32),
                  const SizedBox(height: 12),
                  Text('${(s.payloadWeightLbs / 1000).toStringAsFixed(1)}k', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 32, color: Colors.black87)),
                  const Text('Payload (lbs)', style: TextStyle(color: Colors.grey, fontSize: 12)),
                  const Divider(height: 24),
                  const Text('Heavy', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 20, color: Colors.orange)),
                  const Text('Burn Modifier', style: TextStyle(color: Colors.grey, fontSize: 12)),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
  
  Widget _buildSearchingCard(EvRoutingSession s) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: const Padding(
        padding: EdgeInsets.all(32),
        child: Column(
          children: [
            CircularProgressIndicator(color: Colors.teal),
            SizedBox(height: 16),
            Text('Monitoring Range & Infrastructure...', style: TextStyle(color: Colors.grey)),
          ],
        ),
      ),
    );
  }

  Widget _buildChargerCard(EvChargerLocation c) {
    return Card(
      elevation: 8,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Colors.green, width: 2),
      ),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.green[50],
              borderRadius: const BorderRadius.only(topLeft: Radius.circular(16), topRight: Radius.circular(16)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(c.stationName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                      const SizedBox(height: 4),
                      Text(c.address, style: TextStyle(color: Colors.grey[700])),
                    ],
                  ),
                ),
                Icon(Icons.ev_station, color: Colors.green[800], size: 32),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Distance:', style: TextStyle(fontSize: 16)),
                    Text('${c.distanceMiles} miles', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Hardware:', style: TextStyle(fontSize: 16)),
                    Text(c.chargerType, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.teal[900])),
                  ],
                ),
                const Divider(height: 32),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: Colors.green[700], borderRadius: BorderRadius.circular(8)),
                  child: Column(
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(Icons.check_circle, color: Colors.white),
                          const SizedBox(width: 8),
                          const Text('BAY SECURED', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
                        ],
                      ),
                      const SizedBox(height: 4),
                      const Text('Routing via optimized path. Zero wait time.', textAlign: TextAlign.center, style: TextStyle(color: Colors.white70, fontSize: 14)),
                    ],
                  ),
                )
              ],
            ),
          )
        ],
      ),
    );
  }
}
