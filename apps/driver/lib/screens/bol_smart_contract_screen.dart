import 'package:flutter/material.dart';
import '../models/bol_smart_contract_model.dart';
import '../services/bol_smart_contract_service.dart';

class BolSmartContractScreen extends StatefulWidget {
  const BolSmartContractScreen({super.key});

  @override
  State<BolSmartContractScreen> createState() => _BolSmartContractScreenState();
}

class _BolSmartContractScreenState extends State<BolSmartContractScreen> {
  final BolSmartContractService _service = BolSmartContractService();
  SmartContractBol? _contract;

  @override
  void initState() {
    super.initState();
    _service.contractStream.listen((data) {
      if (mounted) setState(() => _contract = data);
    });
    _service.simulateDeliveryAndPayout();
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
        title: const Text('BOL Smart Contract'),
        backgroundColor: Colors.purple[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _contract == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final c = _contract!;
    
    return Column(
      children: [
        _buildStatusHeader(c),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildPayoutCard(c),
              const SizedBox(height: 24),
              const Text('DIGITAL FREIGHT MANIFEST', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              ...c.items.map((item) => _buildBolItemCard(item)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(SmartContractBol c) {
    Color headerColor = Colors.purple[800]!;
    IconData icon = Icons.description;
    
    if (c.status.contains('Scanning')) {
      headerColor = Colors.orange[800]!;
      icon = Icons.qr_code_scanner;
    } else if (c.status.contains('Executed')) {
      headerColor = Colors.green[700]!;
      icon = Icons.verified;
    }

    return AnimatedContainer(
      duration: const Duration(milliseconds: 500),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: headerColor,
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('SMART CONTRACT BOL', style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold, letterSpacing: 2)),
            ],
          ),
          const SizedBox(height: 16),
          Text(c.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            decoration: BoxDecoration(color: Colors.black26, borderRadius: BorderRadius.circular(8)),
            child: Text('TxHash: ${c.blockHash}', style: const TextStyle(color: Colors.white70, fontFamily: 'monospace', fontSize: 12)),
          )
        ],
      ),
    );
  }

  Widget _buildPayoutCard(SmartContractBol c) {
    bool isPaid = c.status.contains('Executed');
    
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: isPaid ? Colors.green : Colors.transparent, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const Text('ESCROW PAYOUT AMOUNT', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            const SizedBox(height: 8),
            Text('\$${c.payoutAmount.toStringAsFixed(2)}', style: TextStyle(color: isPaid ? Colors.green[700] : Colors.black87, fontSize: 48, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _buildPartyInfo('Shipper', c.shipper),
                const Icon(Icons.arrow_forward, color: Colors.grey),
                _buildPartyInfo('Receiver', c.receiver),
              ],
            )
          ],
        ),
      ),
    );
  }
  
  Widget _buildPartyInfo(String role, String name) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(role, style: const TextStyle(color: Colors.grey, fontSize: 12)),
          const SizedBox(height: 4),
          Text(name, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
        ],
      ),
    );
  }

  Widget _buildBolItemCard(BolItem item) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: Colors.grey[300]!)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: Colors.purple[50], borderRadius: BorderRadius.circular(8)),
              child: const Icon(Icons.inventory_2, color: Colors.purple),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item.description, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  const SizedBox(height: 4),
                  Text('SKU: ${item.sku}', style: const TextStyle(color: Colors.grey, fontSize: 12, fontFamily: 'monospace')),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text('Qty: ${item.quantity}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                Text('${item.weightLbs.toInt()} lbs', style: const TextStyle(color: Colors.grey, fontSize: 12)),
              ],
            )
          ],
        ),
      ),
    );
  }
}
