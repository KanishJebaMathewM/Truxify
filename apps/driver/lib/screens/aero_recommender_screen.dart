import 'package:flutter/material.dart';
import '../models/aero_recommendation_model.dart';
import '../services/aero_ml_service.dart';

class AeroRecommenderScreen extends StatefulWidget {
  const AeroRecommenderScreen({super.key});

  @override
  State<AeroRecommenderScreen> createState() => _AeroRecommenderScreenState();
}

class _AeroRecommenderScreenState extends State<AeroRecommenderScreen> {
  final AeroMlService _mlService = AeroMlService();
  FleetAeroProfile? _profile;
  bool _isAnalyzing = false;

  void _runAnalysis() async {
    setState(() => _isAnalyzing = true);
    final data = await _mlService.analyzeFleetProfile('FLT-9921-X');
    if (mounted) {
      setState(() {
        _profile = data;
        _isAnalyzing = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Aero AI Recommender'),
        backgroundColor: Colors.teal[800],
      ),
      backgroundColor: Colors.grey[100],
      body: _profile == null
          ? _buildEmptyState()
          : Column(
              children: [
                _buildProfileSummary(),
                Expanded(
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _profile!.recommendations.length,
                    itemBuilder: (context, index) {
                      return _buildModCard(_profile!.recommendations[index]);
                    },
                  ),
                ),
              ],
            ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.air, size: 80, color: Colors.teal[200]),
            const SizedBox(height: 16),
            const Text(
              'Deep Learning Aerodynamics',
              style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            const Text(
              'Analyze your fleet\'s historical speed profiles and routes to calculate the exact ROI of deploying aerodynamic add-ons.',
              style: TextStyle(fontSize: 16, color: Colors.grey),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 32),
            _isAnalyzing
                ? const CircularProgressIndicator()
                : ElevatedButton.icon(
                    onPressed: _runAnalysis,
                    icon: const Icon(Icons.analytics),
                    label: const Text('RUN PHYSICS-ML INFERENCE'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.teal[800],
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
                    ),
                  )
          ],
        ),
      ),
    );
  }

  Widget _buildProfileSummary() {
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.all(24),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Fleet Analyzed', style: TextStyle(color: Colors.grey, fontSize: 12)),
                  Text('${_profile!.totalTrailers} Trailers', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                ],
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  const Text('Avg Hwy Speed', style: TextStyle(color: Colors.grey, fontSize: 12)),
                  Text('${_profile!.avgHighwaySpeedMph} MPH', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: Colors.teal)),
                ],
              )
            ],
          ),
          const SizedBox(height: 16),
          LinearProgressIndicator(
            value: _profile!.percentHighwayMiles / 100,
            backgroundColor: Colors.grey[200],
            color: Colors.teal,
            minHeight: 8,
          ),
          const SizedBox(height: 8),
          Text('${_profile!.percentHighwayMiles}% Highway Routing Profile', style: const TextStyle(color: Colors.grey, fontSize: 12)),
        ],
      ),
    );
  }

  Widget _buildModCard(AeroModification mod) {
    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      elevation: 2,
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(child: Text(mod.modName, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold))),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(color: Colors.green[50], borderRadius: BorderRadius.circular(8)),
                  child: Text('${mod.projectedFuelSavingsPercentage}% SAVINGS', style: TextStyle(color: Colors.green[800], fontWeight: FontWeight.bold, fontSize: 12)),
                )
              ],
            ),
            const SizedBox(height: 8),
            Text(mod.description, style: TextStyle(color: Colors.grey[700], fontSize: 14)),
            const Divider(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildStatColumn('Est Cost', '\$${mod.estimatedCost.toInt()}'),
                _buildStatColumn('Annual Savings', '\$${mod.annualSavingsPerTruck.toInt()}', isGood: true),
                _buildStatColumn('ROI', '${mod.roiMonths} mo', isGood: true),
              ],
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                const Icon(Icons.auto_graph, size: 16, color: Colors.grey),
                const SizedBox(width: 4),
                Text('Model Confidence: ${mod.confidenceLevel}', style: const TextStyle(color: Colors.grey, fontSize: 12, fontStyle: FontStyle.italic)),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildStatColumn(String label, String value, {bool isGood = false}) {
    return Column(
      children: [
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
        const SizedBox(height: 4),
        Text(value, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: isGood ? Colors.green[800] : Colors.black87)),
      ],
    );
  }
}
