import 'package:flutter/material.dart';
import '../models/carbon_emissions_model.dart';
import '../services/carbon_emissions_service.dart';

class CarbonEmissionsScreen extends StatefulWidget {
  const CarbonEmissionsScreen({super.key});

  @override
  State<CarbonEmissionsScreen> createState() => _CarbonEmissionsScreenState();
}

class _CarbonEmissionsScreenState extends State<CarbonEmissionsScreen> {
  final CarbonEmissionsService _service = CarbonEmissionsService();
  CarbonEmissionsSession? _session;

  @override
  void initState() {
    super.initState();
    _service.emissionsStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.initializeDashboard();
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
        title: const Text('Fleet Carbon Emissions'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: (_session?.isCompiling == true || _session?.esgReport != null)
            ? null 
            : () => _service.compileEsgReport(),
        backgroundColor: Colors.green[700],
        icon: const Icon(Icons.eco),
        label: const Text('Compile ESG Report'),
      ),
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
              if (s.esgReport != null) ...[
                _buildESGReportCard(s.esgReport!),
                const SizedBox(height: 24),
              ],
              const Text('RAW EXPENSE TELEMETRY', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              ...s.rawFuelData.map((f) => _buildFuelCard(f)),
              const SizedBox(height: 80), // Padding for FAB
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(CarbonEmissionsSession s) {
    bool isComplete = s.esgReport != null;
    
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: s.isCompiling ? Colors.indigo[600] : (isComplete ? Colors.green[800] : Colors.blueGrey[800]),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              s.isCompiling 
                ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3))
                : Icon(isComplete ? Icons.verified : Icons.analytics, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('CORPORATE ESG ANALYTICS', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildESGReportCard(CarbonEmissionReport report) {
    return Card(
      elevation: 6,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: Colors.green[700]!, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('ESG COMPLIANCE REPORT', style: TextStyle(color: Colors.green[900], fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                    Text(report.reportingPeriod, style: const TextStyle(color: Colors.grey, fontSize: 12)),
                  ],
                ),
                Icon(Icons.assignment_turned_in, color: Colors.green[700], size: 36),
              ],
            ),
            const Divider(height: 32),
            _buildReportMetric('Gross Fleet Emissions', '${report.grossFleetEmissions.toStringAsFixed(2)} Metric Tons CO2', Colors.black, isLarge: true),
            const SizedBox(height: 16),
            _buildReportMetric('Diesel Combustion', '${report.totalDieselCO2MetricTons.toStringAsFixed(2)} MT', Colors.blueGrey),
            const SizedBox(height: 8),
            _buildReportMetric('DEF Exhaust Fluid', '${report.totalDefCO2MetricTons.toStringAsFixed(2)} MT', Colors.blueGrey),
            const Divider(height: 32),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: Colors.green[50], borderRadius: BorderRadius.circular(8)),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Fleet Efficiency Rating', style: TextStyle(color: Colors.green[900], fontWeight: FontWeight.bold)),
                  Text('${report.efficiencyRating} kg CO2/mi', style: TextStyle(color: Colors.green[900], fontWeight: FontWeight.bold, fontSize: 18)),
                ],
              ),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: () {},
                icon: const Icon(Icons.send),
                label: const Text('Export to Corporate Portal'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.green[800],
                  side: BorderSide(color: Colors.green[800]!),
                ),
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildReportMetric(String label, String value, Color color, {bool isLarge = false}) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: TextStyle(color: isLarge ? Colors.grey[700] : Colors.grey, fontSize: isLarge ? 14 : 12, fontWeight: isLarge ? FontWeight.bold : FontWeight.normal)),
        Text(value, style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: isLarge ? 24 : 14)),
      ],
    );
  }

  Widget _buildFuelCard(FuelConsumption f) {
    return Card(
      elevation: 1,
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              children: [
                const Icon(Icons.date_range, color: Colors.indigo, size: 20),
                const SizedBox(width: 12),
                Text(f.quarter, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              ],
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text('${f.dieselGallonsPurchased.toStringAsFixed(0)} gal Diesel', style: const TextStyle(fontWeight: FontWeight.bold)),
                Text('${f.defGallonsPurchased.toStringAsFixed(0)} gal DEF', style: const TextStyle(color: Colors.grey, fontSize: 12)),
              ],
            )
          ],
        ),
      ),
    );
  }
}
