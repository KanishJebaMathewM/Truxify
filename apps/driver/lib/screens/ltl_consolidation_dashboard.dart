import 'package:flutter/material.dart';
import '../models/ltl_consolidation_model.dart';
import '../services/ltl_recommendation_engine.dart';

class LtlConsolidationDashboard extends StatefulWidget {
  const LtlConsolidationDashboard({super.key});

  @override
  State<LtlConsolidationDashboard> createState() => _LtlConsolidationDashboardState();
}

class _LtlConsolidationDashboardState extends State<LtlConsolidationDashboard> {
  final LtlRecommendationEngine _engine = LtlRecommendationEngine();
  List<LtlConsolidationLoad> _recommendations = [];
  bool _isScanning = false;
  bool _hasScanned = false;

  void _scanLoadBoard() async {
    setState(() {
      _isScanning = true;
    });

    final results = await _engine.findAddOnLoads(
      currentOrigin: 'Chicago, IL',
      currentDestination: 'Cincinnati, OH',
      availableLinearFeet: 24.0, // Half an empty 53ft trailer
      availableWeightLbs: 22000.0,
    );

    if (mounted) {
      setState(() {
        _recommendations = results;
        _isScanning = false;
        _hasScanned = true;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('LTL Consolidation Engine'),
        backgroundColor: Colors.blue[900],
      ),
      backgroundColor: Colors.grey[200],
      body: Column(
        children: [
          _buildTrailerStatusHeader(),
          if (_isScanning)
            const Expanded(
              child: Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    CircularProgressIndicator(),
                    SizedBox(height: 16),
                    Text('Scanning load board for matching LTL freight...', style: TextStyle(color: Colors.grey, fontSize: 16)),
                  ],
                ),
              ),
            )
          else if (!_hasScanned)
            Expanded(
              child: Center(
                child: ElevatedButton.icon(
                  onPressed: _scanLoadBoard,
                  icon: const Icon(Icons.search),
                  label: const Text('FIND ADD-ON LOADS'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.blue[900],
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
                  ),
                ),
              ),
            )
          else if (_recommendations.isEmpty)
            const Expanded(
              child: Center(child: Text('No suitable add-on loads found for your route.')),
            )
          else
            Expanded(
              child: ListView.builder(
                padding: const EdgeInsets.all(16.0),
                itemCount: _recommendations.length,
                itemBuilder: (context, index) {
                  return _buildRecommendationCard(_recommendations[index]);
                },
              ),
            )
        ],
      ),
    );
  }

  Widget _buildTrailerStatusHeader() {
    return Container(
      width: double.infinity,
      color: Colors.white,
      padding: const EdgeInsets.all(24.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Primary Route', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          const Text('Chicago, IL ➔ Cincinnati, OH', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: Colors.blue[50], borderRadius: BorderRadius.circular(8)),
                  child: const Column(
                    children: [
                      Text('Available Space', style: TextStyle(color: Colors.blue, fontWeight: FontWeight.bold)),
                      SizedBox(height: 4),
                      Text('24.0 Linear Ft', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: Colors.blue[50], borderRadius: BorderRadius.circular(8)),
                  child: const Column(
                    children: [
                      Text('Available Weight', style: TextStyle(color: Colors.blue, fontWeight: FontWeight.bold)),
                      SizedBox(height: 4),
                      Text('22,000 lbs', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                    ],
                  ),
                ),
              ),
            ],
          )
        ],
      ),
    );
  }

  Widget _buildRecommendationCard(LtlConsolidationLoad load) {
    return Card(
      margin: const EdgeInsets.only(bottom: 16.0),
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(20.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: load.matchScore > 90 ? Colors.green[100] : Colors.orange[100],
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    '${load.matchScore}% Match',
                    style: TextStyle(
                      color: load.matchScore > 90 ? Colors.green[900] : Colors.orange[900],
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                Text('+\$${load.addedRevenue.toStringAsFixed(2)}', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: Colors.green)),
              ],
            ),
            const SizedBox(height: 16),
            Text('${load.origin} ➔ ${load.destination}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            Row(
              children: [
                Icon(Icons.straighten, size: 16, color: Colors.grey[600]),
                const SizedBox(width: 4),
                Text('${load.requiredLinearFeet} ft', style: TextStyle(color: Colors.grey[700])),
                const SizedBox(width: 16),
                Icon(Icons.scale, size: 16, color: Colors.grey[600]),
                const SizedBox(width: 4),
                Text('${load.weightLbs} lbs', style: TextStyle(color: Colors.grey[700])),
                const SizedBox(width: 16),
                Icon(Icons.alt_route, size: 16, color: Colors.grey[600]),
                const SizedBox(width: 4),
                Text('+${load.detourMiles} mi detour', style: TextStyle(color: Colors.grey[700])),
              ],
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () {
                  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Booked Add-on Load: ${load.loadId}')));
                },
                style: ElevatedButton.styleFrom(backgroundColor: Colors.blue[900], foregroundColor: Colors.white),
                child: const Text('BOOK ADD-ON LOAD'),
              ),
            )
          ],
        ),
      ),
    );
  }
}
