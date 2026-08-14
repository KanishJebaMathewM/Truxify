import 'package:flutter/material.dart';
import '../models/dynamic_fuel_hedging_wallet_model.dart';
import '../services/dynamic_fuel_hedging_wallet_service.dart';

class DynamicFuelHedgingWalletScreen extends StatefulWidget {
  const DynamicFuelHedgingWalletScreen({super.key});

  @override
  State<DynamicFuelHedgingWalletScreen> createState() => _DynamicFuelHedgingWalletScreenState();
}

class _DynamicFuelHedgingWalletScreenState extends State<DynamicFuelHedgingWalletScreen> {
  final DynamicFuelHedgingWalletService _service = DynamicFuelHedgingWalletService();
  FuelHedgingWallet? _wallet;
  bool _isRedeeming = false;
  String? _redeemingContractId;

  @override
  void initState() {
    super.initState();
    _loadWallet();
  }

  void _loadWallet() async {
    final w = await _service.getWalletDashboard();
    if (mounted) setState(() => _wallet = w);
  }

  void _redeem(FuelFutureContract contract) async {
    setState(() {
      _isRedeeming = true;
      _redeemingContractId = contract.contractId;
    });

    final success = await _service.redeemContract(contract.contractId);
    
    if (mounted) {
      setState(() {
        _isRedeeming = false;
        _redeemingContractId = null;
      });
      if (success) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Authorized pump for ${contract.gallonsLocked} gallons at \$${contract.lockedPricePerGallonUsd}!'), backgroundColor: Colors.green),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Fuel Futures Wallet'),
        backgroundColor: Colors.teal[900],
      ),
      backgroundColor: Colors.grey[100],
      body: _wallet == null 
          ? const Center(child: CircularProgressIndicator()) 
          : _buildDashboard(),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () {},
        backgroundColor: Colors.teal[800],
        icon: const Icon(Icons.add_shopping_cart, color: Colors.white),
        label: const Text('BUY FUTURES', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
      ),
    );
  }

  Widget _buildDashboard() {
    double totalSavings = _wallet!.activeContracts.fold(0, (sum, contract) => sum + contract.potentialSavings);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _buildWalletHeader(totalSavings),
        const SizedBox(height: 24),
        const Text('ACTIVE FUEL HEDGES', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
        const SizedBox(height: 8),
        ..._wallet!.activeContracts.map((c) => _buildContractCard(c)),
      ],
    );
  }

  Widget _buildWalletHeader(double totalSavings) {
    return Card(
      color: Colors.teal[900],
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          children: [
            const Text('AVAILABLE BALANCE', style: TextStyle(color: Colors.white70, letterSpacing: 1.2)),
            const SizedBox(height: 8),
            Text('\$${_wallet!.availableBalanceUsd.toStringAsFixed(2)}', style: const TextStyle(color: Colors.white, fontSize: 36, fontWeight: FontWeight.bold)),
            const Divider(color: Colors.white24, height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Unrealized Hedge Savings:', style: TextStyle(color: Colors.white70)),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  decoration: BoxDecoration(color: Colors.greenAccent.withOpacity(0.2), borderRadius: BorderRadius.circular(12)),
                  child: Text('+\$${totalSavings.toStringAsFixed(2)}', style: const TextStyle(color: Colors.greenAccent, fontWeight: FontWeight.bold)),
                )
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildContractCard(FuelFutureContract c) {
    bool isRedeemingThis = _isRedeeming && _redeemingContractId == c.contractId;
    bool isProfitable = c.potentialSavings > 0;

    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Icon(Icons.local_gas_station, color: Colors.teal[700]),
                    const SizedBox(width: 8),
                    Text(c.stationChain, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  ],
                ),
                Text('${c.gallonsLocked.toInt()} GAL', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.grey[800])),
              ],
            ),
            const SizedBox(height: 4),
            Text(c.locationArea, style: const TextStyle(color: Colors.grey, fontSize: 12)),
            const Divider(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _buildPriceColumn('LOCKED PRICE', '\$${c.lockedPricePerGallonUsd.toStringAsFixed(2)}', Colors.teal[900]!),
                const Icon(Icons.compare_arrows, color: Colors.grey),
                _buildPriceColumn('CURRENT PUMP', '\$${c.currentPumpPriceUsd.toStringAsFixed(2)}', Colors.grey[800]!),
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(color: isProfitable ? Colors.green[50] : Colors.red[50], borderRadius: BorderRadius.circular(8)),
                  child: Column(
                    children: [
                      Text('SAVINGS', style: TextStyle(color: isProfitable ? Colors.green : Colors.red, fontSize: 10, fontWeight: FontWeight.bold)),
                      Text('\$${c.potentialSavings.toStringAsFixed(2)}', style: TextStyle(color: isProfitable ? Colors.green : Colors.red, fontWeight: FontWeight.bold)),
                    ],
                  ),
                )
              ],
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: ElevatedButton(
                onPressed: _isRedeeming ? null : () => _redeem(c),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.teal[800],
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                ),
                child: isRedeemingThis 
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                    : const Text('REDEEM AT PUMP (NFC)', style: TextStyle(fontWeight: FontWeight.bold)),
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildPriceColumn(String label, String value, Color color) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 10, fontWeight: FontWeight.bold)),
        Text(value, style: TextStyle(color: color, fontSize: 18, fontWeight: FontWeight.bold)),
      ],
    );
  }
}
