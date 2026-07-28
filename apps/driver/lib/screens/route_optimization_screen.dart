import 'package:flutter/material.dart';
import '../models/route_stop_model.dart';
import '../services/route_optimization_service.dart';

class RouteOptimizationScreen extends StatefulWidget {
  const RouteOptimizationScreen({super.key});

  @override
  State<RouteOptimizationScreen> createState() => _RouteOptimizationScreenState();
}

class _RouteOptimizationScreenState extends State<RouteOptimizationScreen> {
  final RouteOptimizationService _optimizationService = RouteOptimizationService();
  bool _isOptimizing = false;
  List<RouteStop> _stops = [];

  @override
  void initState() {
    super.initState();
    _loadMockData();
  }

  void _loadMockData() {
    final now = DateTime.now();
    _stops = [
      RouteStop(id: '1', address: '123 Logistics Way', latitude: 34.05, longitude: -118.25, deliveryWindowStart: now.add(const Duration(hours: 3)), deliveryWindowEnd: now.add(const Duration(hours: 5))),
      RouteStop(id: '2', address: '789 Freight Blvd', latitude: 34.01, longitude: -118.30, deliveryWindowStart: now.add(const Duration(hours: 1)), deliveryWindowEnd: now.add(const Duration(hours: 2))),
      RouteStop(id: '3', address: '456 Cargo Drive', latitude: 34.07, longitude: -118.20, deliveryWindowStart: now.add(const Duration(hours: 2)), deliveryWindowEnd: now.add(const Duration(hours: 4))),
    ];
  }

  Future<void> _runOptimization() async {
    setState(() {
      _isOptimizing = true;
    });

    // Simulate current driver GPS location
    final optimized = await _optimizationService.optimizeRoute(_stops, 34.00, -118.15);

    setState(() {
      _stops = optimized;
      _isOptimizing = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AI Route Optimization'),
        backgroundColor: Colors.blueAccent[700],
      ),
      body: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(16.0),
            color: Colors.blue[50],
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Current Route Itinerary', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                ElevatedButton.icon(
                  onPressed: _isOptimizing ? null : _runOptimization,
                  icon: _isOptimizing ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.auto_awesome),
                  label: const Text('Optimize AI'),
                  style: ElevatedButton.styleFrom(backgroundColor: Colors.blueAccent, foregroundColor: Colors.white),
                )
              ],
            ),
          ),
          Expanded(
            child: ListView.builder(
              itemCount: _stops.length,
              itemBuilder: (context, index) {
                final stop = _stops[index];
                return Card(
                  margin: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
                  child: ListTile(
                    leading: CircleAvatar(
                      backgroundColor: stop.isOptimized ? Colors.green : Colors.grey,
                      child: Text('${index + 1}', style: const TextStyle(color: Colors.white)),
                    ),
                    title: Text(stop.address, style: const TextStyle(fontWeight: FontWeight.bold)),
                    subtitle: Text('Window: ${stop.deliveryWindowStart.hour}:00 - ${stop.deliveryWindowEnd.hour}:00\nLat: ${stop.latitude} | Lon: ${stop.longitude}'),
                    trailing: stop.isOptimized ? const Icon(Icons.check_circle, color: Colors.green) : null,
                  ),
                );
              },
            ),
          )
        ],
      ),
    );
  }
}
