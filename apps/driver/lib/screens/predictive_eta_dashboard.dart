import 'package:flutter/material.dart';
import '../models/predictive_eta_model.dart';
import '../services/eta_ml_engine.dart';
import 'package:intl/intl.dart';

class PredictiveEtaDashboard extends StatefulWidget {
  const PredictiveEtaDashboard({super.key});

  @override
  State<PredictiveEtaDashboard> createState() => _PredictiveEtaDashboardState();
}

class _PredictiveEtaDashboardState extends State<PredictiveEtaDashboard> {
  final EtaMlEngine _engine = EtaMlEngine();
  PredictiveEta? _etaData;
  bool _isLoading = false;

  void _generateEta() async {
    setState(() {
      _isLoading = true;
    });

    final data = await _engine.calculatePredictiveEta(
      loadId: 'LD-9921',
      remainingDriveTimeHours: 3.5, // Will trigger a 30 min break penalty
      destinationFacilityId: 'FAC-WALMART-01',
    );

    if (mounted) {
      setState(() {
        _etaData = data;
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('ML Predictive ETA'),
        backgroundColor: Colors.deepPurple[800],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoading
          ? Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const CircularProgressIndicator(color: Colors.deepPurple),
                  const SizedBox(height: 16),
                  Text('Analyzing Hours of Service & Weather...', style: TextStyle(color: Colors.deepPurple[800])),
                ],
              ),
            )
          : _etaData == null
              ? Center(
                  child: ElevatedButton.icon(
                    onPressed: _generateEta,
                    icon: const Icon(Icons.analytics),
                    label: const Text('CALCULATE SHIPPER ETA'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.deepPurple[800],
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
                    ),
                  ),
                )
              : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final dateFormat = DateFormat('MMM d, h:mm a');

    return SingleChildScrollView(
      padding: const EdgeInsets.all(24.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Shipper Visibility Portal', style: TextStyle(color: Colors.grey, fontSize: 16, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Text('Load: ${_etaData!.loadId}', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
          const SizedBox(height: 24),
          
          Card(
            elevation: 4,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            child: Padding(
              padding: const EdgeInsets.all(24.0),
              child: Column(
                children: [
                  const Text('ML PREDICTED ARRIVAL', style: TextStyle(color: Colors.deepPurple, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
                  const SizedBox(height: 12),
                  Text(dateFormat.format(_etaData!.mlPredictedEta), style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  Text('Standard Routing ETA was ${dateFormat.format(_etaData!.standardEta)}', style: const TextStyle(color: Colors.grey, decoration: TextDecoration.lineThrough)),
                ],
              ),
            ),
          ),
          
          const SizedBox(height: 32),
          const Text('Delay Factors (Auto-Calculated)', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 12),
          
          ..._etaData!.delayFactors.entries.map((entry) => Card(
            child: ListTile(
              leading: Icon(
                entry.key.contains('Weather') ? Icons.cloud 
                : entry.key.contains('HoS') ? Icons.access_time 
                : Icons.warehouse,
                color: Colors.orange,
              ),
              title: Text(entry.key, style: const TextStyle(fontWeight: FontWeight.bold)),
              trailing: Text('+${entry.value} min', style: const TextStyle(color: Colors.red, fontWeight: FontWeight.bold, fontSize: 16)),
            ),
          )),
          
          const SizedBox(height: 32),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: Colors.deepPurple[50], borderRadius: BorderRadius.circular(8)),
            child: Row(
              children: [
                Icon(Icons.check_circle, color: Colors.deepPurple[800]),
                const SizedBox(width: 12),
                const Expanded(child: Text('This dynamic ETA is actively shared with the Shipper via the API, preventing unnecessary "check calls".')),
              ],
            ),
          )
        ],
      ),
    );
  }
}
