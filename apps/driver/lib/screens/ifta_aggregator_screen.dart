import 'package:flutter/material.dart';
import '../models/ifta_aggregator_model.dart';
import '../services/ifta_aggregator_service.dart';

class IftaAggregatorScreen extends StatefulWidget {
  const IftaAggregatorScreen({super.key});

  @override
  State<IftaAggregatorScreen> createState() => _IftaAggregatorScreenState();
}

class _IftaAggregatorScreenState extends State<IftaAggregatorScreen> {
  final IftaAggregatorService _service = IftaAggregatorService();
  IftaQuarterlyReport? _report;

  @override
  void initState() {
    super.initState();
    _service.reportStream.listen((data) {
      if (mounted) setState(() => _report = data);
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
        title: const Text('IFTA Automation'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _report == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _report?.isAggregating == true ? null : () => _service.runAggregatorPipeline(),
        backgroundColor: Colors.indigo,
        icon: const Icon(Icons.calculate),
        label: const Text('Run IFTA Pipeline'),
      ),
    );
  }

  Widget _buildDashboard() {
    final r = _report!;

    return Column(
      children: [
        _buildStatusHeader(r),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildQuarterlySummaryCard(r),
              const SizedBox(height: 24),
              const Text('STATE-BY-STATE BREAKDOWN', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              if (r.records.isEmpty)
                const Center(child: Padding(
                  padding: EdgeInsets.all(32.0),
                  child: Text('No data aggregated. Tap Run Pipeline.', style: TextStyle(color: Colors.grey)),
                ))
              else
                ...r.records.map((rec) => _buildStateRecordCard(rec)),
              const SizedBox(height: 80),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(IftaQuarterlyReport r) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: r.isAggregating ? Colors.indigo[600] : Colors.blueGrey[800],
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              r.isAggregating 
                ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3))
                : const Icon(Icons.analytics, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('TAX DATA AGGREGATOR', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(r.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildQuarterlySummaryCard(IftaQuarterlyReport r) {
    return Card(
      elevation: 4,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: Colors.indigo, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('FILING PERIOD', style: TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    Text(r.quarter, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
                  ],
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Text('EST. TOTAL IFTA TAX', style: TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    Text('\$${r.totalTaxOwed.toStringAsFixed(2)}', style: TextStyle(color: Colors.red[800], fontSize: 24, fontWeight: FontWeight.bold)),
                  ],
                ),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildStateRecordCard(IftaStateRecord rec) {
    return Card(
      elevation: 1,
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: Colors.indigo[50],
          child: Text(rec.stateCode, style: TextStyle(color: Colors.indigo[900], fontWeight: FontWeight.bold)),
        ),
        title: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('${rec.milesDriven} Miles'),
            Text('${rec.gallonsPurchased} Gal'),
          ],
        ),
        subtitle: const Text('State Tax Liability'),
        trailing: Text('\$${rec.calculatedTax.toStringAsFixed(2)}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.red)),
      ),
    );
  }
}
