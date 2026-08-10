import 'package:flutter/material.dart';
import '../models/ltl_load_model.dart';
import '../services/ltl_matching_service.dart';

class LtlConsolidationScreen extends StatefulWidget {
  const LtlConsolidationScreen({super.key});

  @override
  State<LtlConsolidationScreen> createState() => _LtlConsolidationScreenState();
}

class _LtlConsolidationScreenState extends State<LtlConsolidationScreen> {
  final LtlMatchingService _ltlService = LtlMatchingService();
  List<LtlLoad> _suggestedLoads = [];
  bool _isLoading = true;

  // Mock current truck state
  final int _availableSpaces = 10; // Out of 26 max pallets
  final int _availableWeight = 12000; // Lbs

  @override
  void initState() {
    super.initState();
    _scanForLtlLoads();
  }

  void _scanForLtlLoads() async {
    final loads = await _ltlService.findCompatibleLtlLoads(_availableSpaces, _availableWeight);
    if (mounted) {
      setState(() {
        _suggestedLoads = loads;
        _isLoading = false;
      });
    }
  }

  void _acceptLoad(LtlLoad load) {
    if (load.requiredPalletSpaces > _availableSpaces || load.weightLbs > _availableWeight) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Cannot accept: Exceeds available capacity.'), backgroundColor: Colors.red)
      );
      return;
    }

    setState(() {
      _suggestedLoads.removeWhere((l) => l.loadId == load.loadId);
    });
    
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Accepted ${load.loadId}. Route updated (+${load.addedMiles} miles).'),
        backgroundColor: Colors.green[800],
      )
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('LTL Consolidation Matcher'),
        backgroundColor: Colors.purple[900],
      ),
      backgroundColor: Colors.grey[200],
      body: Column(
        children: [
          _buildCapacityDashboard(),
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _suggestedLoads.length,
                    itemBuilder: (context, index) {
                      return _buildLtlLoadCard(_suggestedLoads[index]);
                    },
                  ),
          )
        ],
      ),
    );
  }

  Widget _buildCapacityDashboard() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.purple[800],
        borderRadius: const BorderRadius.only(bottomLeft: Radius.circular(24), bottomRight: Radius.circular(24)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Current Trailer Availability', style: TextStyle(color: Colors.white70, fontSize: 16)),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _buildCapacityMetric(Icons.inventory_2, '$_availableSpaces / 26', 'Pallet Spaces'),
              _buildCapacityMetric(Icons.scale, '$_availableWeight lbs', 'Available Weight'),
            ],
          ),
          const SizedBox(height: 24),
          const Row(
            children: [
              Icon(Icons.radar, color: Colors.yellowAccent),
              SizedBox(width: 8),
              Text('Scanning active route for profitable LTL matches...', style: TextStyle(color: Colors.white)),
            ],
          )
        ],
      ),
    );
  }

  Widget _buildCapacityMetric(IconData icon, String value, String label) {
    return Column(
      children: [
        Icon(icon, color: Colors.white, size: 32),
        const SizedBox(height: 8),
        Text(value, style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold)),
        Text(label, style: const TextStyle(color: Colors.white70)),
      ],
    );
  }

  Widget _buildLtlLoadCard(LtlLoad load) {
    final bool isOverCapacity = load.requiredPalletSpaces > _availableSpaces || load.weightLbs > _availableWeight;

    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(color: Colors.green[50], borderRadius: BorderRadius.circular(12)),
                  child: Text('${load.matchScore}% Route Match', style: TextStyle(color: Colors.green[800], fontWeight: FontWeight.bold)),
                ),
                Text('\$${load.payout.toStringAsFixed(2)}', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.green)),
              ],
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                const Icon(Icons.location_on, color: Colors.purple, size: 20),
                const SizedBox(width: 8),
                Expanded(child: Text('Pickup: ${load.pickupLocation}')),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(Icons.flag, color: Colors.redAccent, size: 20),
                const SizedBox(width: 8),
                Expanded(child: Text('Dropoff: ${load.dropoffLocation}')),
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildLoadDetail(Icons.inventory_2, '${load.requiredPalletSpaces} spaces', isOverCapacity ? Colors.red : Colors.grey[800]!),
                _buildLoadDetail(Icons.scale, '${load.weightLbs} lbs', isOverCapacity ? Colors.red : Colors.grey[800]!),
                _buildLoadDetail(Icons.route, '+${load.addedMiles} mi', Colors.orange[800]!),
              ],
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: isOverCapacity ? null : () => _acceptLoad(load),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.purple[800],
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  disabledBackgroundColor: Colors.grey[400],
                ),
                child: Text(isOverCapacity ? 'EXCEEDS CAPACITY' : 'ADD TO ROUTE'),
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildLoadDetail(IconData icon, String text, Color color) {
    return Row(
      children: [
        Icon(icon, size: 16, color: color),
        const SizedBox(width: 4),
        Text(text, style: TextStyle(color: color, fontWeight: FontWeight.bold)),
      ],
    );
  }
}
