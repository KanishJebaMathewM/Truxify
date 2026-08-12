import 'package:flutter/material.dart';
import '../models/esg_emission_report_model.dart';
import '../services/carbon_tracking_service.dart';

class EsgReportingDashboardScreen extends StatefulWidget {
  const EsgReportingDashboardScreen({super.key});

  @override
  State<EsgReportingDashboardScreen> createState() => _EsgReportingDashboardScreenState();
}

class _EsgReportingDashboardScreenState extends State<EsgReportingDashboardScreen> {
  final CarbonTrackingService _trackingService = CarbonTrackingService();
  List<EsgEmissionReport> _reports = [];
  bool _isLoading = true;
  double _totalEmissions = 0.0;

  @override
  void initState() {
    super.initState();
    _fetchHistoricalReports();
  }

  Future<void> _fetchHistoricalReports() async {
    // Simulate fetching past load data and running the ESG calculations
    final r1 = await _trackingService.generateEmissionReport(loadReference: 'LD-8812', distanceMiles: 450, loadWeightLbs: 38000, fuelEfficiencyMpg: 7.5);
    final r2 = await _trackingService.generateEmissionReport(loadReference: 'LD-8813', distanceMiles: 1200, loadWeightLbs: 22000, fuelEfficiencyMpg: 7.5);
    final r3 = await _trackingService.generateEmissionReport(loadReference: 'LD-8814', distanceMiles: 300, loadWeightLbs: 45000, fuelEfficiencyMpg: 7.0);

    if (mounted) {
      setState(() {
        _reports = [r1, r2, r3];
        _totalEmissions = _reports.fold(0, (sum, item) => sum + item.co2EmissionsKg);
        _isLoading = false;
      });
    }
  }

  Future<void> _exportReport(EsgEmissionReport report) async {
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Generating ESG Compliance PDF...')));
    
    final success = await _trackingService.exportComplianceReport(report);
    
    if (success && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Report exported and sent to Shipper successfully!')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('ESG Carbon Footprint'),
        backgroundColor: Colors.green[800],
      ),
      body: _isLoading 
        ? const Center(child: CircularProgressIndicator())
        : Column(
            children: [
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(24.0),
                color: Colors.green[50],
                child: Column(
                  children: [
                    const Icon(Icons.eco, size: 64, color: Colors.green),
                    const SizedBox(height: 16),
                    const Text('Total Fleet CO2 Emissions (This Quarter)', style: TextStyle(color: Colors.grey, fontSize: 16)),
                    const SizedBox(height: 8),
                    Text('${(_totalEmissions / 1000).toStringAsFixed(2)} Metric Tons', 
                      style: TextStyle(color: Colors.green[900], fontSize: 32, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: ListView.builder(
                  itemCount: _reports.length,
                  itemBuilder: (context, index) {
                    final report = _reports[index];
                    return Card(
                      margin: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
                      child: Padding(
                        padding: const EdgeInsets.all(16.0),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text('Load: ${report.loadReference}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                                Text('${report.co2EmissionsKg.toStringAsFixed(1)} kg CO2', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.orange)),
                              ],
                            ),
                            const SizedBox(height: 8),
                            Text('Distance: ${report.distanceMiles} mi | Weight: ${report.loadWeightLbs} lbs', style: const TextStyle(color: Colors.grey)),
                            Text('Effective Fuel Efficiency: ${report.fuelEfficiencyMpg.toStringAsFixed(1)} MPG', style: const TextStyle(color: Colors.grey)),
                            const SizedBox(height: 16),
                            SizedBox(
                              width: double.infinity,
                              child: OutlinedButton.icon(
                                onPressed: () => _exportReport(report),
                                icon: const Icon(Icons.download),
                                label: const Text('EXPORT ESG COMPLIANCE REPORT'),
                                style: OutlinedButton.styleFrom(foregroundColor: Colors.green[800]),
                              ),
                            )
                          ],
                        ),
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
