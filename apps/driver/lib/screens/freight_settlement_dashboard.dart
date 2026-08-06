import 'package:flutter/material.dart';
import '../models/smart_contract_model.dart';
import '../services/blockchain_settlement_service.dart';

class FreightSettlementDashboard extends StatefulWidget {
  final String loadId;
  
  const FreightSettlementDashboard({super.key, this.loadId = 'LD-99120'});

  @override
  State<FreightSettlementDashboard> createState() => _FreightSettlementDashboardState();
}

class _FreightSettlementDashboardState extends State<FreightSettlementDashboard> {
  final BlockchainSettlementService _blockchainService = BlockchainSettlementService();
  FreightSmartContract? _contract;
  bool _isLoading = true;
  bool _isSettling = false;

  @override
  void initState() {
    super.initState();
    _loadContract();
  }

  void _loadContract() async {
    final contract = await _blockchainService.getContractStatus(widget.loadId);
    if (mounted) {
      setState(() {
        _contract = contract;
        _isLoading = false;
      });
    }
  }

  void _triggerSmartContract() async {
    setState(() {
      _isSettling = true;
    });

    // Simulate uploading POD and triggering blockchain payment
    final settledContract = await _blockchainService.triggerSettlement(_contract!.contractId, 'mock_pod_url');

    if (mounted) {
      setState(() {
        _contract = settledContract;
        _isSettling = false;
      });
      _showSuccessDialog();
    }
  }

  void _showSuccessDialog() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Colors.green[50],
        title: const Row(
          children: [
            Icon(Icons.check_circle, color: Colors.green, size: 32),
            SizedBox(width: 8),
            Text('Payment Settled!'),
          ],
        ),
        content: Text(
          '\$${_contract!.payoutAmount.toStringAsFixed(2)} has been instantly transferred to your wallet via the smart contract.',
          style: const TextStyle(fontSize: 16),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('VIEW WALLET'),
          )
        ],
      )
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Smart Contract Settlement'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _buildContractDetails(),
    );
  }

  Widget _buildContractDetails() {
    final bool isSettled = _contract!.status == 'SETTLED';

    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Card(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            child: Padding(
              padding: const EdgeInsets.all(24.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Load Contract', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        decoration: BoxDecoration(
                          color: isSettled ? Colors.green[100] : Colors.blue[100],
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Text(
                          isSettled ? 'FUNDS CLEARED' : 'FUNDS IN ESCROW',
                          style: TextStyle(
                            color: isSettled ? Colors.green[900] : Colors.blue[900],
                            fontWeight: FontWeight.bold,
                            fontSize: 12,
                          ),
                        ),
                      )
                    ],
                  ),
                  const SizedBox(height: 16),
                  Text(_contract!.loadId, style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  Text('Broker: ${_contract!.brokerName}', style: const TextStyle(fontSize: 16)),
                  const Divider(height: 32),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Payout Amount', style: TextStyle(fontSize: 18)),
                      Text(
                        '\$${_contract!.payoutAmount.toStringAsFixed(2)}',
                        style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.green),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      const Icon(Icons.account_balance_wallet, color: Colors.grey, size: 16),
                      const SizedBox(width: 8),
                      Text('Wallet: ${_contract!.walletAddress}', style: const TextStyle(color: Colors.grey, fontFamily: 'monospace')),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      const Icon(Icons.link, color: Colors.grey, size: 16),
                      const SizedBox(width: 8),
                      Text('Tx Hash: ${_contract!.contractId}', style: const TextStyle(color: Colors.grey, fontFamily: 'monospace')),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),
          const Text('Settlement Conditions', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          const SizedBox(height: 16),
          _buildConditionRow('Destination Geofence Breached', true),
          _buildConditionRow('Clean Bill of Lading Uploaded', isSettled),
          const Spacer(),
          if (!isSettled)
            SizedBox(
              height: 56,
              child: ElevatedButton.icon(
                onPressed: _isSettling ? null : _triggerSmartContract,
                icon: _isSettling 
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)) 
                    : const Icon(Icons.upload_file),
                label: Text(_isSettling ? 'VERIFYING ON BLOCKCHAIN...' : 'UPLOAD POD & GET PAID'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.blueGrey[900],
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))
                ),
              ),
            )
        ],
      ),
    );
  }

  Widget _buildConditionRow(String text, bool isMet) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12.0),
      child: Row(
        children: [
          Icon(isMet ? Icons.check_circle : Icons.radio_button_unchecked, color: isMet ? Colors.green : Colors.grey),
          const SizedBox(width: 12),
          Text(text, style: TextStyle(color: isMet ? Colors.black : Colors.grey, fontSize: 16)),
        ],
      ),
    );
  }
}
