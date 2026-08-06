import 'package:flutter/material.dart';
import '../models/carbon_credit_model.dart';
import '../services/eco_driving_service.dart';

class EcoRewardsDashboard extends StatefulWidget {
  const EcoRewardsDashboard({super.key});

  @override
  State<EcoRewardsDashboard> createState() => _EcoRewardsDashboardState();
}

class _EcoRewardsDashboardState extends State<EcoRewardsDashboard> {
  final EcoDrivingService _ecoService = EcoDrivingService();
  Map<String, dynamic>? _walletData;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadWallet();
  }

  void _loadWallet() async {
    final data = await _ecoService.fetchDriverEcoWallet();
    if (mounted) {
      setState(() {
        _walletData = data;
        _isLoading = false;
      });
    }
  }

  void _redeemTokens() {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (context) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Redeem Eco-Tokens', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            _buildRewardOption(Icons.local_cafe, 'Free Coffee (Loves)', '50 Tokens'),
            _buildRewardOption(Icons.shower, 'Free Shower Pass', '150 Tokens'),
            _buildRewardOption(Icons.card_giftcard, '\$50 Amazon Gift Card', '1000 Tokens'),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  Widget _buildRewardOption(IconData icon, String title, String cost) {
    return ListTile(
      leading: Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(color: Colors.green[50], shape: BoxShape.circle),
        child: Icon(icon, color: Colors.green[800]),
      ),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.bold)),
      trailing: ElevatedButton(
        onPressed: () {
          Navigator.pop(context);
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Redeemed $title!')));
        },
        style: ElevatedButton.styleFrom(backgroundColor: Colors.green[800], foregroundColor: Colors.white),
        child: Text(cost),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Eco-Driving Wallet'),
        backgroundColor: Colors.green[900],
      ),
      backgroundColor: Colors.grey[100],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              child: Column(
                children: [
                  _buildWalletHeader(),
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Recent Eco-Trips', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                        const SizedBox(height: 16),
                        ...(_walletData!['recentTrips'] as List<EcoTripData>).map((trip) => _buildTripCard(trip)),
                      ],
                    ),
                  )
                ],
              ),
            ),
    );
  }

  Widget _buildWalletHeader() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.green[800],
        borderRadius: const BorderRadius.only(bottomLeft: Radius.circular(32), bottomRight: Radius.circular(32)),
      ),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            decoration: BoxDecoration(color: Colors.yellow[700], borderRadius: BorderRadius.circular(20)),
            child: Text(_walletData!['currentTier'], style: const TextStyle(color: Colors.black87, fontWeight: FontWeight.bold)),
          ),
          const SizedBox(height: 24),
          const Text('Carbon Token Balance', style: TextStyle(color: Colors.white70)),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              const Icon(Icons.eco, color: Colors.lightGreenAccent, size: 40),
              const SizedBox(width: 8),
              Text('${_walletData!['totalTokens']}', style: const TextStyle(color: Colors.white, fontSize: 64, fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 16),
          Text('Lifetime CO2 Saved: ${_walletData!['lifetimeCo2SavedKg']} kg', style: const TextStyle(color: Colors.white, fontSize: 16)),
          const SizedBox(height: 24),
          ElevatedButton.icon(
            onPressed: _redeemTokens,
            icon: const Icon(Icons.shopping_bag),
            label: const Text('REDEEM TOKENS'),
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.white,
              foregroundColor: Colors.green[900],
              padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 12),
              textStyle: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
          )
        ],
      ),
    );
  }

  Widget _buildTripCard(EcoTripData trip) {
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
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(trip.tripId, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                    Text(trip.drivingBehavior, style: TextStyle(color: Colors.green[800], fontSize: 14)),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(color: Colors.green[50], borderRadius: BorderRadius.circular(12)),
                  child: Row(
                    children: [
                      const Icon(Icons.eco, color: Colors.green, size: 16),
                      const SizedBox(width: 4),
                      Text('+${trip.earnedCarbonTokens}', style: TextStyle(color: Colors.green[900], fontWeight: FontWeight.bold)),
                    ],
                  ),
                )
              ],
            ),
            const Divider(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildStatMetric('CO2 Avoided', '${trip.co2EmissionsAvoidedKg} kg'),
                _buildStatMetric('Fuel Saved', '${trip.gallonsSaved} gal'),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildStatMetric(String label, String value) {
    return Column(
      children: [
        Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }
}
