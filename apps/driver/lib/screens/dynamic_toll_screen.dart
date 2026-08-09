import 'package:flutter/material.dart';
import '../models/dynamic_toll_model.dart';
import '../services/dynamic_toll_service.dart';

class DynamicTollScreen extends StatefulWidget {
  const DynamicTollScreen({super.key});

  @override
  State<DynamicTollScreen> createState() => _DynamicTollScreenState();
}

class _DynamicTollScreenState extends State<DynamicTollScreen> {
  final DynamicTollService _service = DynamicTollService();
  List<DynamicTollRoute>? _routes;
  bool _isAnalyzing = false;
  final double _grossRevenue = 1200.00; // Mock revenue for the load

  void _runAnalysis() async {
    setState(() {
      _isAnalyzing = true;
      _routes = null;
    });

    final results = await _service.analyzeRoutes(_grossRevenue);

    if (mounted) {
      setState(() {
        _routes = results;
        _isAnalyzing = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Toll Route Profit Optimizer'),
        backgroundColor: Colors.teal[900],
      ),
      backgroundColor: Colors.grey[200],
      body: Column(
        children: [
          _buildLoadHeader(),
          Expanded(
            child: _isAnalyzing
                ? const Center(child: CircularProgressIndicator())
                : _routes == null
                    ? _buildEmptyState()
                    : _buildRoutesList(),
          )
        ],
      ),
    );
  }

  Widget _buildLoadHeader() {
    return Container(
      padding: const EdgeInsets.all(24),
      color: Colors.white,
      child: Column(
        children: [
          const Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Origin: New York, NY', style: TextStyle(fontWeight: FontWeight.bold)),
              Icon(Icons.arrow_forward, color: Colors.grey),
              Text('Dest: Richmond, VA', style: TextStyle(fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Gross Load Revenue:', style: TextStyle(color: Colors.grey)),
              Text('\$${_grossRevenue.toStringAsFixed(2)}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.green)),
            ],
          ),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            height: 50,
            child: ElevatedButton.icon(
              onPressed: _isAnalyzing ? null : _runAnalysis,
              icon: const Icon(Icons.analytics),
              label: const Text('CALCULATE PROFITABLE ROUTES', style: TextStyle(fontWeight: FontWeight.bold)),
              style: ElevatedButton.styleFrom(backgroundColor: Colors.teal[900], foregroundColor: Colors.white),
            ),
          )
        ],
      ),
    );
  }

  Widget _buildEmptyState() {
    return const Center(
      child: Text('Press calculate to scrape Class-8 toll pricing.', style: TextStyle(color: Colors.grey)),
    );
  }

  Widget _buildRoutesList() {
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _routes!.length,
      itemBuilder: (context, index) {
        final r = _routes![index];
        return Card(
          margin: const EdgeInsets.only(bottom: 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: BorderSide(color: r.isHighestProfit ? Colors.teal : Colors.transparent, width: 2)
          ),
          child: Column(
            children: [
              if (r.isHighestProfit)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  decoration: const BoxDecoration(
                    color: Colors.teal,
                    borderRadius: BorderRadius.only(topLeft: Radius.circular(14), topRight: Radius.circular(14))
                  ),
                  child: const Center(child: Text('HIGHEST PROFIT ROUTE', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
                ),
              Padding(
                padding: const EdgeInsets.all(24.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(r.routeName, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 16),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Toll Costs (5-axle):', style: TextStyle(color: Colors.grey)),
                        Text('\$${r.class8TollCostUsd.toStringAsFixed(2)}', style: TextStyle(color: Colors.red[800], fontWeight: FontWeight.bold)),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Est. Fuel Cost:', style: TextStyle(color: Colors.grey)),
                        Text('\$${r.fuelCostUsd.toStringAsFixed(2)}', style: TextStyle(color: Colors.orange[800], fontWeight: FontWeight.bold)),
                      ],
                    ),
                    const Divider(height: 32),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Net Profit:', style: TextStyle(fontWeight: FontWeight.bold)),
                        Text('\$${r.netProfitUsd.toStringAsFixed(2)}', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.green[800])),
                      ],
                    )
                  ],
                ),
              )
            ],
          ),
        );
      },
    );
  }
}
