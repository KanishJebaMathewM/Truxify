import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:truxify_shared/truxify_shared.dart';

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

  /// Parses the GeoJSON Feature shape returned by
  /// `GET /api/demand-heatmap`.
  ///
  /// The older screen expected a `{zones: [...]}` payload from a temporary
  /// FastAPI stub. The production Express route returns a GeoJSON
  /// FeatureCollection, so parsing is kept here to match the real API
  /// contract without coupling the UI to HTTP details.
  static HeatZone? fromFeature(Map<String, dynamic> feature) {
    final geometry = feature['geometry'];
    final properties = feature['properties'];
    if (geometry is! Map || properties is! Map) return null;

    final coordinates = geometry['coordinates'];
    if (coordinates is! List || coordinates.length < 2) return null;

    final lng = _asDouble(coordinates[0]);
    final lat = _asDouble(coordinates[1]);
    final intensity = _asDouble(properties['intensity']);
    if (lat == null || lng == null || intensity == null) return null;

    final address = properties['address'];
    final status = properties['status'];
    final label = address?.toString() ?? status?.toString() ?? 'Demand Zone';

    return HeatZone(
      lat: lat,
      lng: lng,
      intensity: intensity,
      label: label,
    );
  }

  /// Parses either the current GeoJSON response or the legacy `{zones: [...]}`
  /// shape so the screen remains tolerant of older development fixtures.
  static List<HeatZone> fromResponse(Map<String, dynamic> data) {
    final features = data['features'];
    if (features is List) {
      return features
          .whereType<Map>()
          .map((feature) => fromFeature(Map<String, dynamic>.from(feature)))
          .whereType<HeatZone>()
          .toList(growable: false);
    }

    final zones = data['zones'];
    if (zones is List) {
      return zones
          .whereType<Map>()
          .map((zone) => _fromLegacyZone(Map<String, dynamic>.from(zone)))
          .whereType<HeatZone>()
          .toList(growable: false);
    }

    return const [];
  }

  static HeatZone? _fromLegacyZone(Map<String, dynamic> zone) {
    final lat = _asDouble(zone['lat']);
    final lng = _asDouble(zone['lng']);
    final intensity = _asDouble(zone['intensity']);
    if (lat == null || lng == null || intensity == null) return null;
    return HeatZone(
      lat: lat,
      lng: lng,
      intensity: intensity,
      label: zone['label']?.toString() ?? 'Demand Zone',
    );
  }

  static double? _asDouble(dynamic value) {
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value);
    return null;
  }
}

class DemandHeatmapScreen extends StatefulWidget {
  const DemandHeatmapScreen({
    super.key,
    this.apiClient,
  });

  /// Optional injection keeps the screen testable while allowing the app to
  /// supply the same configured client used by the rest of the driver app.
  final ApiClient? apiClient;

  @override
  State<DemandHeatmapScreen> createState() => _DemandHeatmapScreenState();
}

class _DemandHeatmapScreenState extends State<DemandHeatmapScreen> {
  List<HeatZone> _zones = [];
  bool _isLoading = true;
  String? _error;
  late final ApiClient _apiClient;
  late final bool _ownsApiClient;

  @override
  void initState() {
    super.initState();
    _ownsApiClient = widget.apiClient == null;
    _apiClient = widget.apiClient ?? ApiClient();
    _loadHeatmapData();
  }

  Future<void> _loadHeatmapData() async {
    if (!mounted) return;
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final data = await _apiClient.get('/api/demand-heatmap') as Map<String, dynamic>;
      final zones = HeatZone.fromResponse(data);
      if (!mounted) return;
      setState(() {
        _zones = zones;
        _isLoading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Network error: $e';
        _isLoading = false;
      });
    }
  }

  Color _intensityColor(double intensity) {
    if (intensity >= 0.75) return Colors.red.withOpacity(0.7);
    if (intensity >= 0.5) return Colors.orange.withOpacity(0.7);
    return Colors.green.withOpacity(0.7);
  }

  @override
  void dispose() {
    if (_ownsApiClient) _apiClient.close();
    super.dispose();
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
    return Row(
      children: [
        Container(
          width: 12,
          height: 12,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 4),
        Text(label, style: const TextStyle(fontSize: 12)),
      ],
    );
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
          circles: _zones
              .map(
                (zone) => CircleMarker(
                  point: LatLng(zone.lat, zone.lng),
                  radius: 40 + (zone.intensity * 40),
                  color: _intensityColor(zone.intensity),
                  borderColor: _intensityColor(zone.intensity).withOpacity(0.9),
                  borderStrokeWidth: 2,
                ),
              )
              .toList(),
        ),
        MarkerLayer(
          markers: _zones
              .map(
                (zone) => Marker(
                  point: LatLng(zone.lat, zone.lng),
                  width: 80,
                  height: 30,
                  child: Text(
                    zone.label,
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                      shadows: [
                        Shadow(blurRadius: 2, color: Colors.black),
                      ],
                    ),
                    textAlign: TextAlign.center,
                  ),
                ),
              )
              .toList(),
        ),
      ],
    );
  }
}
