import 'package:flutter/material.dart';
import '../models/toll_route_model.dart';
import '../services/toll_optimization_service.dart';

class TollRouteOptimizerScreen extends StatefulWidget {
  final double loadPayout;
  const TollRouteOptimizerScreen({super.key, this.loadPayout = 1250.00});

  @override
  State<TollRouteOptimizerScreen> createState() => _TollRouteOptimizerScreenState();
}

class _TollRouteOptimizerScreenState extends State<TollRouteOptimizerScreen> {
  final TollOptimizationService _tollService = TollOptimizationService();
  List<TollRouteOption> _routes = [];
  bool _isLoading = true;
  String? _selectedRouteId;

  @override
  void initState() {
    super.initState();
    _loadRoutes();
  }

  void _loadRoutes() async {
    final routes = await _tollService.getOptimizedRoutes(widget.loadPayout);
    if (mounted) {
      setState(() {
        _routes = routes;
        _isLoading = false;
        try {
          _selectedRouteId = routes.firstWhere((r) => r.isRecommended).routeId;
        } catch (_) {}
      });
    }
  }

  void _startNavigation() {
    if (_selectedRouteId == null) return;
    final selected = _routes.firstWhere((r) => r.routeId == _selectedRouteId);
    
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Starting navigation via ${selected.routeName}...'),
        backgroundColor: Colors.green,
      )
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Toll & Route Optimizer'),
        backgroundColor: Colors.teal[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                _buildHeader(),
                Expanded(
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _routes.length,
                    itemBuilder: (context, index) {
                      return _buildRouteCard(_routes[index]);
                    },
                  ),
                ),
                _buildStartButton(),
              ],
            ),
    );
  }

  Widget _buildHeader() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: Colors.teal[800],
      child: Column(
        children: [
          const Text('Gross Load Payout', style: TextStyle(color: Colors.white70)),
          Text('\$${widget.loadPayout.toStringAsFixed(2)}', style: const TextStyle(color: Colors.white, fontSize: 36, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          const Text('Select the route that maximizes your net profit.', style: TextStyle(color: Colors.white70, fontSize: 14)),
        ],
      ),
    );
  }

  Widget _buildRouteCard(TollRouteOption route) {
    final isSelected = _selectedRouteId == route.routeId;

    return GestureDetector(
      onTap: () {
        setState(() {
          _selectedRouteId = route.routeId;
        });
      },
      child: Card(
        margin: const EdgeInsets.only(bottom: 16),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: isSelected ? Colors.teal : Colors.transparent, width: 2),
        ),
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(child: Text(route.routeName, style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: isSelected ? Colors.teal[900] : Colors.black))),
                  if (route.isRecommended)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(color: Colors.green[100], borderRadius: BorderRadius.circular(12)),
                      child: const Text('RECOMMENDED', style: TextStyle(color: Colors.green, fontSize: 10, fontWeight: FontWeight.bold)),
                    )
                ],
              ),
              Text(route.description, style: const TextStyle(color: Colors.grey)),
              const Divider(height: 32),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  _buildStat('Drive Time', '${(route.estimatedTimeMinutes / 60).floor()}h ${route.estimatedTimeMinutes % 60}m'),
                  _buildStat('Tolls', '\$${route.estimatedTollCostUsd.toStringAsFixed(2)}', color: route.estimatedTollCostUsd > 100 ? Colors.red : Colors.black),
                  _buildStat('Fuel Cost', '\$${route.estimatedFuelCostUsd.toStringAsFixed(2)}'),
                ],
              ),
              const SizedBox(height: 16),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: isSelected ? Colors.teal[50] : Colors.grey[100],
                  borderRadius: BorderRadius.circular(8)
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Est. Net Profit:', style: TextStyle(fontWeight: FontWeight.bold)),
                    Text('\$${route.netProfitUsd.toStringAsFixed(2)}', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 20, color: route.isRecommended ? Colors.green[700] : Colors.black)),
                  ],
                ),
              )
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStat(String label, String value, {Color color = Colors.black}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(value, style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: color)),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }

  Widget _buildStartButton() {
    return Container(
      padding: const EdgeInsets.all(16),
      width: double.infinity,
      color: Colors.white,
      child: ElevatedButton(
        onPressed: _startNavigation,
        style: ElevatedButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 16),
          backgroundColor: Colors.teal[900],
          foregroundColor: Colors.white,
        ),
        child: const Text('START NAVIGATION', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
      ),
    );
  }
}
