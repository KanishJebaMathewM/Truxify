import 'package:flutter/material.dart';
import '../models/automated_ifta_jurisdiction_model.dart';
import '../services/automated_ifta_jurisdiction_service.dart';

class AutomatedIftaJurisdictionScreen extends StatefulWidget {
  const AutomatedIftaJurisdictionScreen({super.key});

  @override
  State<AutomatedIftaJurisdictionScreen> createState() => _AutomatedIftaJurisdictionScreenState();
}

class _AutomatedIftaJurisdictionScreenState extends State<AutomatedIftaJurisdictionScreen> {
  final AutomatedIftaJurisdictionService _service = AutomatedIftaJurisdictionService();
  IftaQuarterlyReport? _report;
  bool _isGenerating = false;

  void _generateReport() async {
    setState(() {
      _isGenerating = true;
      _report = null;
    });

    final result = await _service.generateQuarterlyReport();

    if (mounted) {
      setState(() {
        _report = result;
        _isGenerating = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('IFTA Auto-Filing'),
        backgroundColor: Colors.teal[800],
      ),
      backgroundColor: Colors.grey[200],
      body: Column(
        children: [
          _buildHeader(),
          Expanded(
            child: _isGenerating
                ? _buildLoadingState()
                : (_report != null ? _buildReportDashboard() : _buildEmptyState()),
          )
        ],
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.all(24),
      color: Colors.white,
      child: Column(
        children: [
          const Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Current Filing Period:', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
              Text('Q3 2026', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.teal)),
            ],
          ),
          const SizedBox(height: 16),
          const Text(
            'GPS waypoints are continuously tracked and cross-referenced with fuel ledger receipts in the background.',
            style: TextStyle(color: Colors.grey, fontSize: 12),
          ),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            height: 50,
            child: ElevatedButton.icon(
              onPressed: _isGenerating ? null : _generateReport,
              icon: const Icon(Icons.receipt_long),
              label: const Text('GENERATE IFTA REPORT', style: TextStyle(fontWeight: FontWeight.bold)),
              style: ElevatedButton.styleFrom(backgroundColor: Colors.teal[800], foregroundColor: Colors.white),
            ),
          )
        ],
      ),
    );
  }

  Widget _buildLoadingState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const CircularProgressIndicator(color: Colors.teal),
          const SizedBox(height: 24),
          Text('Parsing State Polygons...', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.teal[800])),
          const Text('Calculating exact mileage per jurisdiction.', style: TextStyle(color: Colors.grey)),
        ],
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.assessment, size: 80, color: Colors.grey[350]),
          const SizedBox(height: 16),
          Text('No report generated yet.', style: TextStyle(color: Colors.grey[600])),
        ],
      ),
    );
  }

  Widget _buildReportDashboard() {
    final r = _report!;
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          Card(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            elevation: 4,
            child: Padding(
              padding: const EdgeInsets.all(24.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Summary', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                  const Divider(height: 32),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                    children: [
                      _buildSummaryMetric('Total Miles', '${r.totalMiles.toInt()}'),
                      _buildSummaryMetric('Total Fuel', '${r.totalFuelGallons.toInt()} gal'),
                    ],
                  ),
                  const SizedBox(height: 24),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(color: Colors.teal[50], borderRadius: BorderRadius.circular(12)),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Net Tax Owed:', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.teal[900])),
                        Text('\$${r.totalTaxOwed.toStringAsFixed(2)}', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.teal[900])),
                      ],
                    ),
                  )
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          const Align(alignment: Alignment.centerLeft, child: Text('Jurisdiction Breakdown', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.grey))),
          const SizedBox(height: 8),
          ...r.jurisdictionBreakdown.map((j) => _buildJurisdictionCard(j)),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            height: 56,
            child: OutlinedButton.icon(
              onPressed: () {},
              icon: const Icon(Icons.file_download),
              label: const Text('EXPORT READY-TO-FILE CSV'),
              style: OutlinedButton.styleFrom(foregroundColor: Colors.teal[800], side: BorderSide(color: Colors.teal[800]!)),
            ),
          )
        ],
      ),
    );
  }

  Widget _buildSummaryMetric(String label, String value) {
    return Column(
      children: [
        Text(value, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }

  Widget _buildJurisdictionCard(JurisdictionMileage j) {
    bool isCredit = j.taxOwedUsd < 0;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              children: [
                CircleAvatar(backgroundColor: Colors.teal[100], child: Text(j.stateCode, style: TextStyle(color: Colors.teal[900], fontWeight: FontWeight.bold))),
                const SizedBox(width: 16),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${j.milesDriven.toInt()} mi driven', style: const TextStyle(fontWeight: FontWeight.bold)),
                    Text('${j.fuelPurchasedGallons.toInt()} gal bought', style: const TextStyle(color: Colors.grey, fontSize: 12)),
                  ],
                ),
              ],
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  isCredit ? '-\$${j.taxOwedUsd.abs().toStringAsFixed(2)}' : '\$${j.taxOwedUsd.toStringAsFixed(2)}',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: isCredit ? Colors.green : Colors.red),
                ),
                Text(isCredit ? 'Credit' : 'Owed', style: const TextStyle(color: Colors.grey, fontSize: 12)),
              ],
            )
          ],
        ),
      ),
    );
  }
}
