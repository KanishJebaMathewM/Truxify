import 'package:flutter/material.dart';
import '../models/smart_contract_model.dart';
import '../services/smart_contract_service.dart';

class SettlementWalletScreen extends StatefulWidget {
  const SettlementWalletScreen({super.key});

  @override
  State<SettlementWalletScreen> createState() => _SettlementWalletScreenState();
}

class _SettlementWalletScreenState extends State<SettlementWalletScreen> {
  final SmartContractService _contractService = SmartContractService();
  List<FreightSmartContract> _contracts = [];
  bool _isLoading = true;
  double _walletBalance = 4250.00; // Mock current balance

  @override
  void initState() {
    super.initState();
    _loadContracts();
  }

  Future<void> _loadContracts() async {
    final contracts = await _contractService.fetchActiveContracts();
    if (mounted) {
      setState(() {
        _contracts = contracts;
        _isLoading = false;
      });
    }
  }

  Future<void> _processPayout(FreightSmartContract contract) async {
    if (contract.status == 'RELEASED') return;
    if (!contract.isGeofenceConfirmed || !contract.isPodUploaded) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('PoD upload and GPS arrival required before payout.')),
      );
      return;
    }

    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Verifying conditions and executing smart contract...')),
    );

    final success = await _contractService.triggerPayout(contract.contractId);
    if (success && mounted) {
      setState(() {
        _walletBalance += contract.payoutAmount;
        // Update local state to reflect released contract
        final index = _contracts.indexOf(contract);
        _contracts[index] = FreightSmartContract(
          contractId: contract.contractId,
          loadId: contract.loadId,
          brokerName: contract.brokerName,
          payoutAmount: contract.payoutAmount,
          isGeofenceConfirmed: true,
          isPodUploaded: true,
          status: 'RELEASED',
          walletAddress: contract.walletAddress,
          createdAt: contract.createdAt,
          settledAt: DateTime.now(),
        );
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('\$${contract.payoutAmount} released to wallet instantly!')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Digital Settlement Wallet'),
        backgroundColor: Colors.blueGrey[900],
      ),
      body: _isLoading 
        ? const Center(child: CircularProgressIndicator())
        : Column(
            children: [
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(32.0),
                color: Colors.blueGrey[800],
                child: Column(
                  children: [
                    const Text('Available Balance', style: TextStyle(color: Colors.grey, fontSize: 16)),
                    const SizedBox(height: 8),
                    Text('\$${_walletBalance.toStringAsFixed(2)}', 
                      style: const TextStyle(color: Colors.white, fontSize: 48, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 16),
                    ElevatedButton.icon(
                      onPressed: () {},
                      icon: const Icon(Icons.account_balance),
                      label: const Text('WITHDRAW TO BANK'),
                      style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
                    )
                  ],
                ),
              ),
              const Padding(
                padding: EdgeInsets.all(16.0),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text('Active Smart Contracts', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                ),
              ),
              Expanded(
                child: ListView.builder(
                  itemCount: _contracts.length,
                  itemBuilder: (context, index) {
                    final contract = _contracts[index];
                    final isReleased = contract.status == 'RELEASED';

                    return Card(
                      margin: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
                      child: Padding(
                        padding: const EdgeInsets.all(16.0),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text('Load: ${contract.loadId}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                                Text('\$${contract.payoutAmount.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: Colors.green)),
                              ],
                            ),
                            const SizedBox(height: 12),
                            Row(
                              children: [
                                Icon(Icons.location_on, size: 16, color: contract.isGeofenceConfirmed ? Colors.green : Colors.grey),
                                const SizedBox(width: 4),
                                const Text('Geofence Arrival', style: TextStyle(fontSize: 12)),
                                const SizedBox(width: 16),
                                Icon(Icons.document_scanner, size: 16, color: contract.isPodUploaded ? Colors.green : Colors.grey),
                                const SizedBox(width: 4),
                                const Text('PoD Uploaded', style: TextStyle(fontSize: 12)),
                              ],
                            ),
                            const SizedBox(height: 16),
                            SizedBox(
                              width: double.infinity,
                              child: ElevatedButton(
                                onPressed: isReleased ? null : () => _processPayout(contract),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: isReleased ? Colors.grey[300] : Colors.blueAccent,
                                  foregroundColor: isReleased ? Colors.grey[600] : Colors.white,
                                ),
                                child: Text(isReleased ? 'FUNDS RELEASED' : 'TRIGGER PAYOUT'),
                              ),
                            )
                          ],
                        ),
                      ),
                    );
                  },
                ),
              )
            ],
          ),
    );
  }
}
