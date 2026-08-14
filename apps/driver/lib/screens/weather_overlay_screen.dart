import 'package:flutter/material.dart';
import '../models/weather_overlay_model.dart';
import '../services/weather_overlay_service.dart';

class WeatherOverlayScreen extends StatefulWidget {
  const WeatherOverlayScreen({super.key});

  @override
  State<WeatherOverlayScreen> createState() => _WeatherOverlayScreenState();
}

class _WeatherOverlayScreenState extends State<WeatherOverlayScreen> {
  final WeatherOverlayService _service = WeatherOverlayService();
  WeatherOverlaySession? _session;

  @override
  void initState() {
    super.initState();
    _service.weatherStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.fetchWeatherPolygons();
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
        title: const Text('Spatial Weather Radar'),
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
              if (s.segments.isNotEmpty) ...[
                _buildMockMapUI(s),
                const SizedBox(height: 24),
                const Text('ROUTE SEGMENT ANALYSIS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                const SizedBox(height: 12),
                ...s.segments.map((seg) => _buildSegmentCard(seg)),
              ] else ...[
                const SizedBox(height: 100),
                const Center(child: CircularProgressIndicator()),
              ]
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(WeatherOverlaySession s) {
    bool isComplete = s.status.contains('Complete');
    bool hasHazards = s.totalHazardMiles > 0;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: isComplete ? (hasHazards ? Colors.red[900] : Colors.green[800]) : Colors.blueGrey[800],
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(isComplete ? (hasHazards ? Icons.thunderstorm : Icons.wb_sunny) : Icons.satellite_alt, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('NWS GEOJSON OVERLAY', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildMockMapUI(WeatherOverlaySession s) {
    return Container(
      height: 200,
      decoration: BoxDecoration(
        color: Colors.blueGrey[100],
        border: Border.all(color: Colors.blueGrey, width: 2),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Stack(
        alignment: Alignment.center,
        children: [
          const Icon(Icons.map, size: 100, color: Colors.black12),
          // Mocking the Route Line
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: s.segments.map((seg) {
              return Expanded(
                flex: seg.miles,
                child: Container(
                  height: 16,
                  margin: const EdgeInsets.symmetric(horizontal: 2),
                  decoration: BoxDecoration(
                    color: seg.intersectsWeather ? Colors.red : Colors.blue,
                    borderRadius: BorderRadius.circular(8),
                    boxShadow: seg.intersectsWeather 
                      ? [BoxShadow(color: Colors.red.withOpacity(0.5), blurRadius: 8, spreadRadius: 2)]
                      : null,
                  ),
                ),
              );
            }).toList(),
          ),
          Positioned(
            top: 16,
            left: 16,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(color: Colors.white70, borderRadius: BorderRadius.circular(16)),
              child: Text(s.mapRegion, style: const TextStyle(fontWeight: FontWeight.bold)),
            ),
          )
        ],
      ),
    );
  }

  Widget _buildSegmentCard(RouteSegment seg) {
    return Card(
      elevation: seg.intersectsWeather ? 4 : 1,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: seg.intersectsWeather ? Colors.red[300]! : Colors.transparent, width: 2),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.all(16),
        leading: CircleAvatar(
          backgroundColor: seg.intersectsWeather ? Colors.red[100] : Colors.blue[50],
          child: Icon(seg.intersectsWeather ? Icons.warning : Icons.check, color: seg.intersectsWeather ? Colors.red : Colors.blue),
        ),
        title: Text('${seg.startLocation} ➔ ${seg.endLocation}', style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 4),
            Text('${seg.miles} Miles', style: const TextStyle(color: Colors.black54)),
            if (seg.intersectsWeather) ...[
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(color: Colors.red[50], borderRadius: BorderRadius.circular(4)),
                child: Text('HAZARD INTERSECTION: ${seg.warningType!}', style: TextStyle(color: Colors.red[900], fontSize: 12, fontWeight: FontWeight.bold)),
              )
            ]
          ],
        ),
      ),
    );
  }
}
