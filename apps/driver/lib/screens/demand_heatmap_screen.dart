import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:http/http.dart' as http;

class HeatZone {
  final double lat;
  final double lng;
  final double intensity;
  final String label;

  HeatZone({
    required this.lat,
    required this.lng,
    required this.intensity,
    required this.label,
  });

  factory HeatZone.fromJson(Map<String, dynamic> json) => HeatZone(
        lat: json['lat'],
        lng: json['lng'],
        intensity: json['intensity'],
        label: json['label'],
      );
}

class DemandHeatmapScreen extends StatefulWidget {
  const DemandHeatmapScreen({super.key});

  @override
  State<DemandHeatmapScreen> createState() => _DemandHeatmapScreenState();
}

class _DemandHeatmapScreenState extends State<DemandHeatmapScreen> {
  List<HeatZone> _zones = [];
  bool _isLoading = true;
  String? _error;

  // TODO: Replace with your actual backend URL / ApiService
  static const String _baseUrl = 'http://localhost:8000';

  @override
  void initState() {
    super.initState();
    _loadHeatmapData();
  }

  Future<void> _loadHeatmapData() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final response = await http.get(
        Uri.parse('$_baseUrl/ml/demand-heatmap?hours=48'),
      );
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        final zones = (data['zones'] as List)
            .map((z) => HeatZone.fromJson(z))
            .toList();
        setState(() { _zones = zones; _isLoading = false; });
      } else {
        setState(() { _error = 'Failed to load data'; _isLoading = false; });
      }
    } catch (e) {
      setState(() { _error = 'Network error: $e'; _isLoading = false; });
    }
  }

  Color _intensityColor(double intensity) {
    if (intensity >= 0.75) return Colors.red.withOpacity(0.7);
    if (intensity >= 0.5) return Colors.orange.withOpacity(0.7);
    return Colors.green.withOpacity(0.7);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Demand Heatmap — Next 48 hrs'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadHeatmapData,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(_error!, style: const TextStyle(color: Colors.red)),
                      const SizedBox(height: 16),
                      ElevatedButton(
                        onPressed: _loadHeatmapData,
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                )
              : Column(
                  children: [
                    _buildLegend(),
                    Expanded(child: _buildMap()),
                  ],
                ),
    );
  }

  Widget _buildLegend() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          _legendItem(Colors.green, 'Low demand'),
          _legendItem(Colors.orange, 'Medium demand'),
          _legendItem(Colors.red, 'High demand'),
        ],
      ),
    );
  }

  Widget _legendItem(Color color, String label) {
    return Row(children: [
      Container(width: 12, height: 12, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
      const SizedBox(width: 4),
      Text(label, style: const TextStyle(fontSize: 12)),
    ]);
  }

  Widget _buildMap() {
    return FlutterMap(
      options: const MapOptions(
        initialCenter: LatLng(20.5937, 78.9629),
        initialZoom: 5,
      ),
      children: [
        TileLayer(
          urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          userAgentPackageName: 'com.truxify.driver',
        ),
        CircleLayer(
          circles: _zones.map((zone) => CircleMarker(
            point: LatLng(zone.lat, zone.lng),
            radius: 40 + (zone.intensity * 40),
            color: _intensityColor(zone.intensity),
            borderColor: _intensityColor(zone.intensity).withOpacity(0.9),
            borderStrokeWidth: 2,
          )).toList(),
        ),
        MarkerLayer(
          markers: _zones.map((zone) => Marker(
            point: LatLng(zone.lat, zone.lng),
            width: 80,
            height: 30,
            child: Text(
              zone.label,
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.bold,
                color: Colors.white,
                shadows: [Shadow(blurRadius: 2, color: Colors.black)],
              ),
              textAlign: TextAlign.center,
            ),
          )).toList(),
        ),
      ],
    );
  }
}