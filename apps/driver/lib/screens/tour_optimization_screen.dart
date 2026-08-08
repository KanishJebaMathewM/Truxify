import 'package:flutter/material.dart';
import '../models/tour_optimization_model.dart';
import '../services/tour_optimization_service.dart';
import 'package:intl/intl.dart';

class TourOptimizationScreen extends StatefulWidget {
  const TourOptimizationScreen({super.key});

  @override
  State<TourOptimizationScreen> createState() => _TourOptimizationScreenState();
}

class _TourOptimizationScreenState extends State<TourOptimizationScreen> {
  final TourOptimizationService _service = TourOptimizationService();
  OptimizedTour? _tour;
  bool _isGenerating = false;

  void _generateTour() async {
    setState(() => _isGenerating = true);
    final tour = await _service.generateOptimizedTour('Chicago, IL');
    if (mounted) {
      setState(() {
        _tour = tour;
        _isGenerating = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Multi-Leg Tour Optimizer'),
        backgroundColor: Colors.teal[800],
      ),
      backgroundColor: Colors.grey[100],
      body: _tour == null ? _buildEmptyState() : _buildTourDetails(),
      floatingActionButton: _tour == null 
        ? null 
        : FloatingActionButton.extended(
            onPressed: () {
              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Tour Booked Successfully!')));
            },
            backgroundColor: Colors.teal[800],
            icon: const Icon(Icons.check_circle),
            label: const Text('BOOK FULL TOUR'),
          ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.route, size: 80, color: Colors.teal[200]),
            const SizedBox(height: 16),
            const Text(
              'Eliminate Deadhead Miles',
              style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            const Text(
              'Our AI dynamically strings together back-to-back loads to ensure you return home with less than 5% empty miles.',
              style: TextStyle(fontSize: 16, color: Colors.grey),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 32),
            _isGenerating
                ? const CircularProgressIndicator()
                : ElevatedButton(
                    onPressed: _generateTour,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.teal[800],
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
                    ),
                    child: const Text('GENERATE 3-DAY TOUR', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                  )
          ],
        ),
      ),
    );
  }

  Widget _buildTourDetails() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _buildTourSummaryCard(),
        const SizedBox(height: 24),
        const Text('Tour Itinerary', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        ..._tour!.legs.asMap().entries.map((entry) => _buildLegCard(entry.key + 1, entry.value)).toList(),
        const SizedBox(height: 80), // Padding for FAB
      ],
    );
  }

  Widget _buildTourSummaryCard() {
    final t = _tour!;
    return Card(
      color: Colors.teal[900],
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(20.0),
        child: Column(
          children: [
            const Text('Guaranteed Tour Revenue', style: TextStyle(color: Colors.tealAccent, fontSize: 16)),
            const SizedBox(height: 8),
            Text('\$${t.totalPayout.toStringAsFixed(2)}', style: const TextStyle(color: Colors.white, fontSize: 40, fontWeight: FontWeight.bold)),
            const Divider(color: Colors.white30, height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildSummaryStat('${t.totalLoadedMiles} mi', 'Loaded'),
                _buildSummaryStat('${t.totalEmptyMiles} mi', 'Empty'),
                _buildSummaryStat('${t.emptyMilePercentage.toStringAsFixed(1)}%', 'Deadhead'),
                _buildSummaryStat('${t.durationDays} Days', 'Duration'),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildSummaryStat(String value, String label) {
    return Column(
      children: [
        Text(value, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        Text(label, style: const TextStyle(color: Colors.white70, fontSize: 12)),
      ],
    );
  }

  Widget _buildLegCard(int legNum, TourLeg leg) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: Colors.grey[300]!)),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(color: Colors.teal[50], borderRadius: BorderRadius.circular(12)),
                  child: Text('LEG $legNum', style: TextStyle(color: Colors.teal[800], fontWeight: FontWeight.bold)),
                ),
                Text('\$${leg.payout.toStringAsFixed(2)}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.green)),
              ],
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Column(
                  children: [
                    const Icon(Icons.radio_button_checked, color: Colors.teal),
                    Container(height: 30, width: 2, color: Colors.grey[300]),
                    const Icon(Icons.location_on, color: Colors.red),
                  ],
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(leg.origin, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                      Text('Pickup: ${DateFormat('EEE, MMM d • h:mm a').format(leg.pickupTime)}', style: const TextStyle(color: Colors.grey, fontSize: 12)),
                      const SizedBox(height: 16),
                      Text(leg.destination, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                      Text('Dropoff: ${DateFormat('EEE, MMM d • h:mm a').format(leg.deliveryTime)}', style: const TextStyle(color: Colors.grey, fontSize: 12)),
                    ],
                  ),
                )
              ],
            ),
            const Divider(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('${leg.loadedMiles} loaded miles', style: const TextStyle(color: Colors.grey)),
                Text('${leg.emptyMilesToPickup} empty miles to pickup', style: const TextStyle(color: Colors.orange)),
              ],
            )
          ],
        ),
      ),
    );
  }
}
