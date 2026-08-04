import 'package:flutter/material.dart';
import '../models/weather_reroute_model.dart';
import '../services/weather_rerouting_service.dart';

class WeatherNavigationDashboard extends StatefulWidget {
  const WeatherNavigationDashboard({super.key});

  @override
  State<WeatherNavigationDashboard> createState() => _WeatherNavigationDashboardState();
}

class _WeatherNavigationDashboardState extends State<WeatherNavigationDashboard> {
  final WeatherReroutingService _weatherService = WeatherReroutingService();
  bool _isScanning = false;
  RerouteSuggestion? _activeSuggestion;

  @override
  void initState() {
    super.initState();
    _startContinuousScan();
  }

  void _startContinuousScan() async {
    setState(() {
      _isScanning = true;
    });

    final suggestion = await _weatherService.checkForHazards('current_route_data');

    if (mounted) {
      setState(() {
        _isScanning = false;
        _activeSuggestion = suggestion;
      });
      if (suggestion != null) {
        _showHazardAlert(suggestion.avoidedHazard);
      }
    }
  }

  void _showHazardAlert(WeatherHazard hazard) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        backgroundColor: Colors.red[900],
        title: const Row(
          children: [
            Icon(Icons.warning, color: Colors.white, size: 32),
            SizedBox(width: 12),
            Text('SEVERE HAZARD', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          ],
        ),
        content: Text(
          '${hazard.hazardType} detected ${hazard.milesAhead} miles ahead.\n\n${hazard.description}',
          style: const TextStyle(color: Colors.white, fontSize: 16),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('DISMISS', style: TextStyle(color: Colors.white70)),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(context);
              // In reality, this would transition to the map
            },
            style: ElevatedButton.styleFrom(backgroundColor: Colors.white, foregroundColor: Colors.red[900]),
            child: const Text('VIEW REROUTE'),
          )
        ],
      )
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Dynamic Weather Routing'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: Column(
        children: [
          // Mock Map Area
          Container(
            height: 300,
            width: double.infinity,
            decoration: BoxDecoration(
              color: Colors.blueGrey[100],
              border: const Border(bottom: BorderSide(color: Colors.grey, width: 2)),
            ),
            child: Stack(
              alignment: Alignment.center,
              children: [
                Icon(Icons.map, size: 100, color: Colors.blueGrey[300]),
                if (_isScanning)
                  Positioned(
                    top: 16,
                    right: 16,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 4)]),
                      child: const Row(
                        children: [
                          SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                          SizedBox(width: 8),
                          Text('Scanning Radar...', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                        ],
                      ),
                    ),
                  )
              ],
            ),
          ),
          
          Expanded(
            child: _activeSuggestion == null
                ? const Center(child: Text('Route is clear. No hazards detected.', style: TextStyle(color: Colors.grey, fontSize: 18)))
                : _buildReroutePanel(),
          )
        ],
      ),
    );
  }

  Widget _buildReroutePanel() {
    final hazard = _activeSuggestion!.avoidedHazard;
    
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.all(24.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('PROACTIVE REROUTE AVAILABLE', style: TextStyle(color: Colors.red, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
          const SizedBox(height: 16),
          Card(
            color: Colors.red[50],
            elevation: 0,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: Colors.red[200]!)),
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Row(
                children: [
                  const Icon(Icons.ac_unit, color: Colors.red, size: 32),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Avoid: ${hazard.hazardType}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                        Text('${hazard.milesAhead} miles ahead on current route', style: TextStyle(color: Colors.red[900])),
                      ],
                    ),
                  )
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              Column(
                children: [
                  const Text('Added Distance', style: TextStyle(color: Colors.grey)),
                  Text('+${_activeSuggestion!.addedDistanceMiles} mi', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
                ],
              ),
              Container(width: 1, height: 40, color: Colors.grey[300]),
              Column(
                children: [
                  const Text('Time Impact', style: TextStyle(color: Colors.grey)),
                  Text('+${_activeSuggestion!.timeImpactMinutes} min', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.orange)),
                ],
              ),
            ],
          ),
          const Spacer(),
          ElevatedButton.icon(
            onPressed: () {
              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Navigation updated to alternative route.')));
            },
            icon: const Icon(Icons.alt_route),
            label: const Text('ACCEPT DETOUR', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.green[700],
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 16),
            ),
          )
        ],
      ),
    );
  }
}
