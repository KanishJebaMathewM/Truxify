import 'package:flutter/material.dart';
import '../models/ai_ltl_matching_model.dart';
import '../services/ai_ltl_matching_service.dart';

class AiLtlMatchingScreen extends StatefulWidget {
  const AiLtlMatchingScreen({super.key});

  @override
  State<AiLtlMatchingScreen> createState() => _AiLtlMatchingScreenState();
}

class _AiLtlMatchingScreenState extends State<AiLtlMatchingScreen> {
  final AiLtlMatchingService _service = AiLtlMatchingService();
  TrailerCapacityState? _state;
  bool _isSearching = false;

  void _searchForMatches() async {
    setState(() {
      _isSearching = true;
      _state = null;
    });

    final result = await _service.findLtlMatches();

    if (mounted) {
      setState(() {
        _state = result;
        _isSearching = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AI LTL Freight Matcher'),
        backgroundColor: Colors.purple[800],
      ),
      backgroundColor: Colors.grey[100],
      body: Column(
        children: [
          _buildCapacityDashboard(),
          Expanded(
            child: _isSearching
                ? _buildLoadingState()
                : (_state != null ? _buildMatchesList() : _buildEmptyState()),
          )
        ],
      ),
    );
  }

  Widget _buildCapacityDashboard() {
    // If state is null, assume default mockup of 21ft available out of 53ft.
    double availFeet = _state?.availableLinearFeet ?? 21.0;
    double totalFeet = _state?.totalLinearFeet ?? 53.0;
    double availWeight = _state?.availableWeightLbs ?? 18000.0;

    double usedPct = (totalFeet - availFeet) / totalFeet;

    return Container(
      padding: const EdgeInsets.all(24),
      decoration: const BoxDecoration(
        color: Colors.white,
        boxShadow: [BoxShadow(color: Colors.black12, blurRadius: 8)],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Trailer Space Utilization', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              Text('${(usedPct * 100).toInt()}% Full', style: TextStyle(color: Colors.purple[800], fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 12),
          LinearProgressIndicator(
            value: usedPct,
            backgroundColor: Colors.grey[300],
            color: Colors.purple[800],
            minHeight: 12,
            borderRadius: BorderRadius.circular(6),
          ),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _buildMetric('Available Space', '${availFeet.toInt()} linear ft'),
              _buildMetric('Available Weight', '${availWeight.toInt()} lbs'),
            ],
          ),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            height: 50,
            child: ElevatedButton.icon(
              onPressed: _isSearching ? null : _searchForMatches,
              icon: const Icon(Icons.radar),
              label: const Text('SCAN SPOT MARKET FOR PARTIALS', style: TextStyle(fontWeight: FontWeight.bold)),
              style: ElevatedButton.styleFrom(backgroundColor: Colors.purple[800], foregroundColor: Colors.white),
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
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
        Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
      ],
    );
  }

  Widget _buildLoadingState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const CircularProgressIndicator(color: Colors.purple),
          const SizedBox(height: 16),
          Text('Analyzing route trajectory...', style: TextStyle(color: Colors.purple[800], fontWeight: FontWeight.bold)),
          const Text('Matching partial loads along I-80 corridor.', style: TextStyle(color: Colors.grey)),
        ],
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.search_off, size: 80, color: Colors.grey[300]),
          const SizedBox(height: 16),
          Text('Run a scan to fill your empty space.', style: TextStyle(color: Colors.grey[500])),
        ],
      ),
    );
  }

  Widget _buildMatchesList() {
    final matches = _state!.recommendedMatches;
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: matches.length,
      itemBuilder: (context, index) {
        final m = matches[index];
        return Card(
          margin: const EdgeInsets.only(bottom: 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: BorderSide(color: index == 0 ? Colors.purple : Colors.transparent, width: 2)
          ),
          elevation: index == 0 ? 8 : 2,
          child: Column(
            children: [
              if (index == 0)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  decoration: const BoxDecoration(
                    color: Colors.purple,
                    borderRadius: BorderRadius.only(topLeft: Radius.circular(14), topRight: Radius.circular(14))
                  ),
                  child: Center(child: Text('${m.matchScorePct}% MATCH ALONG ROUTE', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
                ),
              Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(m.pickupCity, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                        const Icon(Icons.arrow_forward, color: Colors.grey, size: 20),
                        Text(m.dropoffCity, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                      ],
                    ),
                    const Divider(height: 32),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceAround,
                      children: [
                        _buildMetric('Requires', '${m.requiredLinearFeet.toInt()} ft'),
                        _buildMetric('Weight', '${m.requiredWeightLbs.toInt()} lbs'),
                        _buildMetric('Detour', '+${m.detourTimeHours} hrs'),
                      ],
                    ),
                    const SizedBox(height: 24),
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(color: Colors.green[50], borderRadius: BorderRadius.circular(8)),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text('Added Revenue', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.green)),
                          Text('+\$${m.additionalPayoutUsd.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 20, color: Colors.green)),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton(
                        onPressed: () {},
                        style: OutlinedButton.styleFrom(foregroundColor: Colors.purple[800], side: BorderSide(color: Colors.purple[800]!)),
                        child: const Text('BOOK PARTIAL LOAD'),
                      ),
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
