import 'package:flutter/material.dart';
import '../models/cargo_theft_risk_model.dart';
import '../services/threat_intelligence_service.dart';

class RiskHeatmapScreen extends StatefulWidget {
  const RiskHeatmapScreen({super.key});

  @override
  State<RiskHeatmapScreen> createState() => _RiskHeatmapScreenState();
}

class _RiskHeatmapScreenState extends State<RiskHeatmapScreen> {
  final ThreatIntelligenceService _threatService = ThreatIntelligenceService();
  List<ThreatZone> _threatZones = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadThreatData();
  }

  void _loadThreatData() async {
    final zones = await _threatService.getActiveThreatZones();
    if (mounted) {
      setState(() {
        _threatZones = zones;
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Cargo Theft Threat Intel'),
        backgroundColor: Colors.red[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                _buildWarningHeader(),
                Expanded(
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _threatZones.length,
                    itemBuilder: (context, index) {
                      return _buildThreatCard(_threatZones[index]);
                    },
                  ),
                ),
              ],
            ),
      floatingActionButton: _isLoading
          ? null
          : FloatingActionButton.extended(
              onPressed: () {
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Route updated to bypass Critical & High risk zones for overnight parking.')));
              },
              backgroundColor: Colors.red[800],
              icon: const Icon(Icons.alt_route),
              label: const Text('REROUTE TO SAFE PARKING'),
            ),
    );
  }

  Widget _buildWarningHeader() {
    return Container(
      color: Colors.red[800],
      padding: const EdgeInsets.all(24),
      child: const Row(
        children: [
          Icon(Icons.warning_amber_rounded, color: Colors.white, size: 48),
          SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('HIGH VALUE LOAD DETECTED', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                SizedBox(height: 4),
                Text('You are hauling Pharmaceuticals. The intelligent routing system has identified several high-risk zones ahead based on live dark web and crime APIs.', 
                  style: TextStyle(color: Colors.white70, fontSize: 12)),
              ],
            ),
          )
        ],
      ),
    );
  }

  Widget _buildThreatCard(ThreatZone zone) {
    Color riskColor;
    switch (zone.riskLevel) {
      case 'Critical': riskColor = Colors.red[900]!; break;
      case 'High': riskColor = Colors.orange[800]!; break;
      case 'Medium': riskColor = Colors.amber[700]!; break;
      default: riskColor = Colors.green;
    }

    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: riskColor.withOpacity(0.1),
              borderRadius: const BorderRadius.only(topLeft: Radius.circular(12), topRight: Radius.circular(12)),
              border: Border(bottom: BorderSide(color: riskColor.withOpacity(0.3))),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(child: Text(zone.locationName, style: TextStyle(color: riskColor, fontWeight: FontWeight.bold, fontSize: 16))),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(color: riskColor, borderRadius: BorderRadius.circular(12)),
                  child: Text(zone.riskLevel.toUpperCase(), style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold)),
                )
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(Icons.policy, size: 16, color: Colors.grey[600]),
                    const SizedBox(width: 8),
                    Text('Source: ${zone.intelSource}', style: TextStyle(color: Colors.grey[600], fontSize: 12, fontStyle: FontStyle.italic)),
                  ],
                ),
                const SizedBox(height: 12),
                const Text('Recent Incidents:', style: TextStyle(fontWeight: FontWeight.bold)),
                const SizedBox(height: 4),
                ...zone.recentIncidents.map((incident) => Padding(
                  padding: const EdgeInsets.only(bottom: 4.0),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('• ', style: TextStyle(color: Colors.red, fontWeight: FontWeight.bold)),
                      Expanded(child: Text(incident, style: TextStyle(color: Colors.grey[800], fontSize: 13))),
                    ],
                  ),
                )).toList()
              ],
            ),
          )
        ],
      ),
    );
  }
}
