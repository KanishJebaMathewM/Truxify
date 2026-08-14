import 'package:flutter/material.dart';
import '../models/toll_optimization_model.dart';
import '../services/toll_optimization_service.dart';

class TollOptimizationScreen extends StatefulWidget {
  const TollOptimizationScreen({super.key});

  @override
  State<TollOptimizationScreen> createState() => _TollOptimizationScreenState();
}

class _TollOptimizationScreenState extends State<TollOptimizationScreen> {
  final TollOptimizationService _service = TollOptimizationService();
  TollOptimizationSession? _session;

  @override
  void initState() {
    super.initState();
    _service.optimizationStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateOptimization();
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
        title: const Text('Financial Routing Engine'),
        backgroundColor: Colors.indigo[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final s = _session!;
    
    return Column(
      children: [
        _buildStatusHeader(s),
        Expanded(
          child: s.alternativeRoutes.isEmpty
              ? _buildLoadingState(s)
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    _buildTripCard(s),
                    const SizedBox(height: 24),
                    const Text('ROUTE COMPARISON', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                    const SizedBox(height: 12),
                    ...s.alternativeRoutes.map((r) => _buildRouteCard(r)),
                  ],
                ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(TollOptimizationSession s) {
    Color headerColor = Colors.indigo[800]!;
    IconData icon = Icons.calculate;
    
    if (s.status.contains('Optimal')) {
      headerColor = Colors.green[700]!;
      icon = Icons.monetization_on;
    }

    return AnimatedContainer(
      duration: const Duration(milliseconds: 500),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: headerColor,
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('PROFIT MAXIMIZER', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold, letterSpacing: 2)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildLoadingState(TollOptimizationSession s) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const CircularProgressIndicator(color: Colors.indigo),
          const SizedBox(height: 24),
          Text(s.status, style: const TextStyle(color: Colors.grey, fontSize: 16)),
        ],
      ),
    );
  }

  Widget _buildTripCard(TollOptimizationSession s) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('ORIGIN', style: TextStyle(color: Colors.grey, fontSize: 12)),
                    Text(s.origin, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  ],
                )),
                const Icon(Icons.arrow_forward, color: Colors.grey),
                Expanded(child: Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Text('DESTINATION', style: TextStyle(color: Colors.grey, fontSize: 12)),
                    Text(s.destination, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  ],
                )),
              ],
            ),
            const Divider(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Text('Gross Revenue (Broker Pay): ', style: TextStyle(color: Colors.grey)),
                Text('\$${s.grossRevenue.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: Colors.black87)),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildRouteCard(RouteFinancials r) {
    return Card(
      elevation: r.isRecommended ? 8 : 2,
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: r.isRecommended ? Colors.green : Colors.transparent, width: 2),
      ),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: r.isRecommended ? Colors.green[50] : Colors.grey[100],
              borderRadius: const BorderRadius.only(topLeft: Radius.circular(16), topRight: Radius.circular(16)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(r.routeName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                    const SizedBox(height: 4),
                    Text(r.routeType, style: TextStyle(color: r.isRecommended ? Colors.green[800] : Colors.grey[700], fontWeight: FontWeight.bold)),
                  ],
                ),
                if (r.isRecommended)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(color: Colors.green, borderRadius: BorderRadius.circular(20)),
                    child: const Text('RECOMMENDED', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12)),
                  )
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              children: [
                _buildCostRow('Tolls (5-Axle)', '\$${r.tollCostDollars.toStringAsFixed(2)}', r.tollCostDollars > 100 ? Colors.red : Colors.black87),
                _buildCostRow('Fuel Cost', '\$${r.fuelCostDollars.toStringAsFixed(2)}', Colors.black87),
                _buildCostRow('Driver Hourly Pay', '\$${r.driverPayDollars.toStringAsFixed(2)}', Colors.black87),
                const Divider(height: 24),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('NET PROFIT', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: Colors.black87)),
                    Text('\$${r.netProfitMargin.toStringAsFixed(2)}', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 24, color: Colors.green[700])),
                  ],
                ),
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    const Icon(Icons.timer, color: Colors.grey, size: 16),
                    const SizedBox(width: 4),
                    Text('Total Trip Time: ${r.timeMinutes} mins', style: const TextStyle(color: Colors.grey, fontSize: 12)),
                  ],
                )
              ],
            ),
          )
        ],
      ),
    );
  }

  Widget _buildCostRow(String label, String value, Color valueColor) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: Colors.grey, fontSize: 14)),
          Text(value, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: valueColor)),
        ],
      ),
    );
  }
}
