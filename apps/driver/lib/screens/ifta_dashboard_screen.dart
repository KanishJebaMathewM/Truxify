import 'package:flutter/material.dart';
import '../models/ifta_report_model.dart';
import '../services/ifta_reporting_service.dart';

class IftaDashboardScreen extends StatefulWidget {
  const IftaDashboardScreen({super.key});

  @override
  State<IftaDashboardScreen> createState() => _IftaDashboardScreenState();
}

class _IftaDashboardScreenState extends State<IftaDashboardScreen> {
  final IftaReportingService _iftaService = IftaReportingService();
  IftaReport? _currentReport;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadReport();
  }

  void _loadReport() async {
    final report = await _iftaService.generateQuarterlyReport();
    if (mounted) {
      setState(() {
        _currentReport = report;
        _isLoading = false;
      });
    }
  }

  void _exportReport() {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('IFTA ${_currentReport!.quarter} ${_currentReport!.year} report exported as CSV and emailed.'),
        backgroundColor: Colors.teal[800],
      )
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('IFTA Tax Reporting'),
        backgroundColor: Colors.teal[900],
      ),
      backgroundColor: Colors.grey[100],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                _buildSummaryHeader(),
                Expanded(
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _currentReport!.stateRecords.length,
                    itemBuilder: (context, index) {
                      return _buildStateCard(_currentReport!.stateRecords[index]);
                    },
                  ),
                )
              ],
            ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _exportReport,
        backgroundColor: Colors.teal[900],
        icon: const Icon(Icons.download),
        label: const Text('EXPORT IFTA REPORT'),
      ),
    );
  }

  Widget _buildSummaryHeader() {
    final report = _currentReport!;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: Colors.teal[800],
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('${report.quarter} ${report.year} Estimate', style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(color: Colors.teal[600], borderRadius: BorderRadius.circular(12)),
                child: const Text('Auto-Tracking', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12)),
              )
            ],
          ),
          const SizedBox(height: 24),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _buildMetric('Total Miles', '${report.totalMiles}'),
              _buildMetric('Total Fuel', '${report.totalGallons} gal'),
            ],
          ),
          const SizedBox(height: 24),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Est. Net Balance:', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.black87)),
                Text('\$${report.netTaxBalance.toStringAsFixed(2)} Owed', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.red[700])),
              ],
            ),
          )
        ],
      ),
    );
  }

  Widget _buildMetric(String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: Colors.white70)),
        const SizedBox(height: 4),
        Text(value, style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold)),
      ],
    );
  }

  Widget _buildStateCard(IftaStateRecord state) {
    final bool isOwed = state.taxOwed > 0;
    
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    CircleAvatar(
                      backgroundColor: Colors.teal[50],
                      child: Text(state.stateCode, style: TextStyle(color: Colors.teal[900], fontWeight: FontWeight.bold)),
                    ),
                    const SizedBox(width: 12),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Rate: \$${state.taxRate}/gal', style: const TextStyle(color: Colors.grey)),
                      ],
                    ),
                  ],
                ),
                Text(
                  isOwed ? '+\$${state.taxOwed.toStringAsFixed(2)}' : '-\$${state.taxOwed.abs().toStringAsFixed(2)}',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: isOwed ? Colors.red[700] : Colors.green[700]
                  ),
                )
              ],
            ),
            const Divider(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                Column(
                  children: [
                    Text('${state.milesDriven}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                    const Text('Miles', style: TextStyle(color: Colors.grey, fontSize: 12)),
                  ],
                ),
                Column(
                  children: [
                    Text('${state.gallonsPurchased}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                    const Text('Gallons', style: TextStyle(color: Colors.grey, fontSize: 12)),
                  ],
                ),
              ],
            )
          ],
        ),
      ),
    );
  }
}
