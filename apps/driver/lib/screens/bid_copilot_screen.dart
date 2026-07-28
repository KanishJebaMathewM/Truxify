import 'package:flutter/material.dart';
import '../models/pricing_insight_model.dart';
import '../services/dynamic_pricing_engine.dart';

class BidCopilotScreen extends StatefulWidget {
  final String loadId;
  final String origin;
  final String destination;
  final double totalMiles;

  const BidCopilotScreen({
    super.key, 
    required this.loadId,
    required this.origin,
    required this.destination,
    required this.totalMiles,
  });

  @override
  State<BidCopilotScreen> createState() => _BidCopilotScreenState();
}

class _BidCopilotScreenState extends State<BidCopilotScreen> {
  final DynamicPricingEngine _pricingEngine = DynamicPricingEngine();
  PricingInsight? _insight;
  bool _isLoading = true;
  double _userBid = 0.0;

  @override
  void initState() {
    super.initState();
    _fetchPricingInsight();
  }

  Future<void> _fetchPricingInsight() async {
    final result = await _pricingEngine.analyzeLoadPricing(
      loadId: widget.loadId,
      origin: widget.origin,
      destination: widget.destination,
      totalMiles: widget.totalMiles,
    );

    if (mounted) {
      setState(() {
        _insight = result;
        _isLoading = false;
        _userBid = result.suggestedBid;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AI Bid Copilot'),
        backgroundColor: Colors.deepPurple[800],
      ),
      body: _isLoading 
        ? Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                CircularProgressIndicator(color: Colors.deepPurple[800]),
                const SizedBox(height: 16),
                const Text('Analyzing Lane Data & Fuel Prices...'),
              ],
            ),
          )
        : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    if (_insight == null) return const SizedBox();

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('${_insight!.laneOrigin} ➔ ${_insight!.laneDestination}', 
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          Text('Total Distance: ${widget.totalMiles.toStringAsFixed(0)} miles', 
            textAlign: TextAlign.center, style: const TextStyle(color: Colors.grey),
          ),
          const SizedBox(height: 24),
          
          Card(
            color: Colors.deepPurple[50],
            child: Padding(
              padding: const EdgeInsets.all(20.0),
              child: Column(
                children: [
                  const Text('AI Suggested Optimal Bid', style: TextStyle(fontSize: 16)),
                  const SizedBox(height: 8),
                  Text('\$${_insight!.suggestedBid.toStringAsFixed(2)}', 
                    style: TextStyle(fontSize: 48, fontWeight: FontWeight.bold, color: Colors.deepPurple[800]),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.analytics, color: Colors.green),
                      const SizedBox(width: 8),
                      Text('${(_insight!.probabilityOfWinning * 100).toStringAsFixed(0)}% Win Probability',
                        style: const TextStyle(color: Colors.green, fontWeight: FontWeight.bold),
                      )
                    ],
                  )
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),
          
          const Text('Market Breakdown', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const Divider(),
          _buildBreakdownRow('Market Average for Lane', '\$${_insight!.marketAverage.toStringAsFixed(2)}'),
          _buildBreakdownRow('Estimated Fuel Surcharge', '\$${_insight!.fuelSurchargeEstimate.toStringAsFixed(2)}'),
          _buildBreakdownRow('Recommended Minimum', '\$${_insight!.minRecommendedBid.toStringAsFixed(2)}'),
          
          const SizedBox(height: 32),
          Text('Your Bid: \$${_userBid.toStringAsFixed(2)}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
          Slider(
            value: _userBid,
            min: _insight!.minRecommendedBid * 0.9,
            max: _insight!.maxRecommendedBid * 1.1,
            activeColor: Colors.deepPurple,
            onChanged: (val) {
              setState(() {
                _userBid = val;
              });
            },
          ),
          
          ElevatedButton(
            onPressed: () {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text('Bid of \$${_userBid.toStringAsFixed(2)} submitted successfully!')),
              );
            },
            style: ElevatedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 16),
              backgroundColor: Colors.deepPurple[800],
              foregroundColor: Colors.white,
            ),
            child: const Text('SUBMIT BID', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
          )
        ],
      ),
    );
  }

  Widget _buildBreakdownRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: Colors.grey, fontSize: 16)),
          Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
        ],
      ),
    );
  }
}
