import 'package:flutter/material.dart';
import '../models/spot_market_oracle_model.dart';
import '../services/spot_market_oracle_service.dart';

class SpotMarketOracleScreen extends StatefulWidget {
  final String loadId;
  const SpotMarketOracleScreen({super.key, this.loadId = 'LOD-9912-GA-TX'});

  @override
  State<SpotMarketOracleScreen> createState() => _SpotMarketOracleScreenState();
}

class _SpotMarketOracleScreenState extends State<SpotMarketOracleScreen> {
  final SpotMarketOracleService _service = SpotMarketOracleService();
  MarketPricingOracle? _oracleData;
  bool _isAnalyzing = false;

  @override
  void initState() {
    super.initState();
    _runOracleAnalysis();
  }

  void _runOracleAnalysis() async {
    setState(() => _isAnalyzing = true);
    final data = await _service.analyzeLoadPricing(widget.loadId);
    if (mounted) {
      setState(() {
        _oracleData = data;
        _isAnalyzing = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Pricing Oracle'),
        backgroundColor: Colors.indigo[800],
      ),
      backgroundColor: Colors.grey[100],
      body: _isAnalyzing
          ? _buildLoadingState()
          : (_oracleData != null ? _buildDashboard() : const Center(child: Text('Error loading oracle.'))),
    );
  }

  Widget _buildLoadingState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const CircularProgressIndicator(color: Colors.indigo),
          const SizedBox(height: 24),
          Text('Ingesting live load board data...', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.indigo[800])),
          const Text('Calculating fair market value.', style: TextStyle(color: Colors.grey)),
        ],
      ),
    );
  }

  Widget _buildDashboard() {
    final o = _oracleData!;
    final diff = o.fairMarketValueUsd - o.brokerOfferUsd;
    
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          _buildLoadHeader(o),
          const SizedBox(height: 16),
          _buildMarketConditionCard(o),
          const SizedBox(height: 16),
          _buildPricingGauge(o, diff),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            height: 56,
            child: ElevatedButton.icon(
              onPressed: () {},
              icon: const Icon(Icons.handshake),
              label: Text('COUNTER OFFER \$${o.fairMarketValueUsd.toInt()}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              style: ElevatedButton.styleFrom(backgroundColor: Colors.indigo[800], foregroundColor: Colors.white),
            ),
          )
        ],
      ),
    );
  }

  Widget _buildLoadHeader(MarketPricingOracle o) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(o.origin, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                const Icon(Icons.arrow_forward, color: Colors.grey),
                Text(o.destination, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Broker Offer:', style: TextStyle(color: Colors.grey, fontSize: 16)),
                Text('\$${o.brokerOfferUsd.toStringAsFixed(2)}', style: const TextStyle(color: Colors.red, fontWeight: FontWeight.bold, fontSize: 20)),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildMarketConditionCard(MarketPricingOracle o) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(color: Colors.green[50], borderRadius: BorderRadius.circular(12), border: Border.all(color: Colors.green[300]!)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.trending_up, color: Colors.green),
              const SizedBox(width: 8),
              Text(o.marketCondition, style: const TextStyle(color: Colors.green, fontWeight: FontWeight.bold, fontSize: 16)),
            ],
          ),
          const SizedBox(height: 8),
          Text('Regional Ratio: ${o.regionalTruckToLoadRatio} loads for every 1 truck.', style: TextStyle(color: Colors.green[800])),
          Text('You have high leverage to negotiate.', style: TextStyle(color: Colors.green[900], fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildPricingGauge(MarketPricingOracle o, double diff) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const Text('AI FAIR MARKET VALUE', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            const SizedBox(height: 8),
            Text('\$${o.fairMarketValueUsd.toStringAsFixed(2)}', style: TextStyle(fontSize: 40, fontWeight: FontWeight.bold, color: Colors.indigo[900])),
            Container(
              margin: const EdgeInsets.symmetric(vertical: 16),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(color: Colors.red[50], borderRadius: BorderRadius.circular(20)),
              child: Text('Broker is underpaying by \$${diff.toStringAsFixed(2)}', style: const TextStyle(color: Colors.red, fontWeight: FontWeight.bold)),
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _buildRangeBound('Low End', '\$${o.lowEndMarketUsd.toInt()}'),
                _buildRangeBound('High End', '\$${o.highEndMarketUsd.toInt()}'),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildRangeBound(String label, String value) {
    return Column(
      children: [
        Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }
}
