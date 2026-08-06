import 'package:flutter/material.dart';
import '../models/smart_contract_payment_model.dart';
import '../services/smart_contract_payment_service.dart';

class WalletSettlementScreen extends StatefulWidget {
  const WalletSettlementScreen({super.key});

  @override
  State<WalletSettlementScreen> createState() => _WalletSettlementScreenState();
}

class _WalletSettlementScreenState extends State<WalletSettlementScreen> {
  final SmartContractPaymentService _paymentService = SmartContractPaymentService();
  List<SmartContractPayment> _contracts = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadContracts();
  }

  void _loadContracts() async {
    final contracts = await _paymentService.getActiveContracts();
    if (mounted) {
      setState(() {
        _contracts = contracts;
        _isLoading = false;
      });
    }
  }

  void _signBolAndSettle(SmartContractPayment contract) async {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const AlertDialog(
        content: Row(
          children: [
            CircularProgressIndicator(),
            SizedBox(width: 16),
            Expanded(child: Text('Executing Smart Contract on Blockchain...')),
          ],
        ),
      )
    );

    final settledContract = await _paymentService.executeSmartContract(contract);

    if (mounted) {
      Navigator.pop(context); // close dialog
      setState(() {
        final index = _contracts.indexWhere((c) => c.contractId == contract.contractId);
        if (index != -1) {
          _contracts[index] = settledContract;
        }
      });
      
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Contract Settled! \$${settledContract.amountUsd} deposited to wallet.'),
          backgroundColor: Colors.green,
        )
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Smart Contract Wallet'),
        backgroundColor: Colors.indigo[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                _buildWalletHeader(),
                Expanded(
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _contracts.length,
                    itemBuilder: (context, index) {
                      return _buildContractCard(_contracts[index]);
                    },
                  ),
                )
              ],
            ),
    );
  }

  Widget _buildWalletHeader() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(32),
      color: Colors.indigo[900],
      child: const Column(
        children: [
          Text('Available Balance', style: TextStyle(color: Colors.white70, fontSize: 16)),
          SizedBox(height: 8),
          Text('\$8,450.00', style: TextStyle(color: Colors.white, fontSize: 40, fontWeight: FontWeight.bold)),
          SizedBox(height: 8),
          Text('8450.00 USDC', style: TextStyle(color: Colors.white54, fontSize: 14)),
        ],
      ),
    );
  }

  Widget _buildContractCard(SmartContractPayment contract) {
    final isSettled = contract.status == 'Settled';
    final canSettle = contract.geoFenceBreached && !contract.bolSigned;

    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(contract.brokerName, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                Text('\$${contract.amountUsd.toStringAsFixed(2)}', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: isSettled ? Colors.green : Colors.black)),
              ],
            ),
            const SizedBox(height: 4),
            Text('Load: ${contract.loadId} • Contract: ${contract.contractId}', style: const TextStyle(color: Colors.grey, fontSize: 12)),
            const Divider(height: 32),
            const Text('Smart Contract Conditions:', style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            _buildConditionRow('Destination Geo-fence Breached', contract.geoFenceBreached),
            const SizedBox(height: 4),
            _buildConditionRow('Digital BOL Signed by Receiver', contract.bolSigned),
            const SizedBox(height: 16),
            if (isSettled)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: Colors.green[50], borderRadius: BorderRadius.circular(8)),
                child: const Text('SETTLED', textAlign: TextAlign.center, style: TextStyle(color: Colors.green, fontWeight: FontWeight.bold)),
              )
            else if (canSettle)
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: () => _signBolAndSettle(contract),
                  icon: const Icon(Icons.draw),
                  label: const Text('SIGN BOL & RELEASE FUNDS'),
                  style: ElevatedButton.styleFrom(backgroundColor: Colors.indigo[900], foregroundColor: Colors.white),
                ),
              )
            else
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: Colors.orange[50], borderRadius: BorderRadius.circular(8)),
                child: Text(contract.status.toUpperCase(), textAlign: TextAlign.center, style: TextStyle(color: Colors.orange[900], fontWeight: FontWeight.bold)),
              )
          ],
        ),
      ),
    );
  }

  Widget _buildConditionRow(String label, bool isMet) {
    return Row(
      children: [
        Icon(isMet ? Icons.check_circle : Icons.radio_button_unchecked, color: isMet ? Colors.green : Colors.grey, size: 20),
        const SizedBox(width: 8),
        Text(label, style: TextStyle(color: isMet ? Colors.black : Colors.grey)),
      ],
    );
  }
}
