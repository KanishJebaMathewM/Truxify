import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/home_time_routing_model.dart';
import '../services/home_time_routing_service.dart';

class HomeTimeRoutingScreen extends StatefulWidget {
  const HomeTimeRoutingScreen({super.key});

  @override
  State<HomeTimeRoutingScreen> createState() => _HomeTimeRoutingScreenState();
}

class _HomeTimeRoutingScreenState extends State<HomeTimeRoutingScreen> {
  final HomeTimeRoutingService _service = HomeTimeRoutingService();
  HomeTimeRouteSession? _session;

  @override
  void initState() {
    super.initState();
    _service.routingStream.listen((data) {
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
        title: const Text('Home Time Routing Algorithm'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _session?.isComputing == true ? null : () {
          DateTime nextFriday = DateTime.now().add(const Duration(days: 5));
          _service.computeHomeTimeRoute(nextFriday);
        },
        backgroundColor: Colors.indigo,
        icon: const Icon(Icons.home),
        label: const Text('Compute Path to Home'),
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
              _buildDriverTargetCard(s),
              const SizedBox(height: 24),
              if (s.optimizedSequence.isNotEmpty) ...[
                const Text('OPTIMIZED LOAD SEQUENCE', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                const SizedBox(height: 12),
                ...s.optimizedSequence.map((l) => _buildLegCard(l)),
                const SizedBox(height: 16),
                _buildTotalPayoutCard(s),
              ] else ...[
                const Center(child: Padding(
                  padding: EdgeInsets.all(32.0),
                  child: Text('Tap Compute to generate a multi-leg route home.', style: TextStyle(color: Colors.grey)),
                ))
              ],
              const SizedBox(height: 80), // Padding for FAB
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(HomeTimeRouteSession s) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: s.isComputing ? Colors.indigo[600] : Colors.blueGrey[800],
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              s.isComputing 
                ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3))
                : const Icon(Icons.account_tree, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('GRAPH SEARCH ENGINE', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildDriverTargetCard(HomeTimeRouteSession s) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Row(
              children: [
                const Icon(Icons.person, color: Colors.indigo),
                const SizedBox(width: 12),
                Text(s.driverName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildMetric('Target Home Zip', s.homeZipCode, Colors.blueGrey),
                _buildMetric('Target Arrival', DateFormat('EEEE, MMM dd').format(s.targetHomeDate), Colors.indigo),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildMetric(String label, String value, Color color) {
    return Column(
      children: [
        Text(value, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: color)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }

  Widget _buildLegCard(RoutingLeg leg) {
    bool isFinalLeg = leg.destination.contains('HOME');
    Color legColor = isFinalLeg ? Colors.green : Colors.indigo;

    return Card(
      elevation: 2,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        side: BorderSide(color: isFinalLeg ? Colors.green : Colors.transparent, width: 2),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Chip(
                  label: Text('LEG ${leg.sequenceNumber}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 10)),
                  backgroundColor: legColor,
                  visualDensity: VisualDensity.compact,
                ),
                Text('\$${leg.payout.toStringAsFixed(2)}', style: TextStyle(color: legColor, fontWeight: FontWeight.bold, fontSize: 18)),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                const Icon(Icons.location_on, color: Colors.grey, size: 16),
                const SizedBox(width: 8),
                Text(leg.origin, style: const TextStyle(fontWeight: FontWeight.bold)),
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 8.0),
                  child: Icon(Icons.arrow_forward, size: 16),
                ),
                Expanded(child: Text(leg.destination, style: TextStyle(fontWeight: FontWeight.bold, color: isFinalLeg ? Colors.green : Colors.black))),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('${leg.miles} Miles', style: const TextStyle(color: Colors.grey, fontSize: 12)),
                Text('Est. Arrival: ${leg.estimatedArrival}', style: const TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold)),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildTotalPayoutCard(HomeTimeRouteSession s) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.green[50], borderRadius: BorderRadius.circular(12), border: Border.all(color: Colors.green, width: 2)),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Total Sequence Revenue', style: TextStyle(color: Colors.green, fontWeight: FontWeight.bold)),
              Text('Driver arrives home successfully', style: TextStyle(color: Colors.green, fontSize: 12)),
            ],
          ),
          Text('\$${s.totalSequencePayout.toStringAsFixed(2)}', style: TextStyle(color: Colors.green[900], fontSize: 24, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }
}
