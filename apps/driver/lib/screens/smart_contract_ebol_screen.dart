import 'package:flutter/material.dart';
import '../models/smart_contract_ebol_model.dart';
import '../services/smart_contract_ebol_service.dart';

class SmartContractEbolScreen extends StatefulWidget {
  const SmartContractEbolScreen({super.key});

  @override
  State<SmartContractEbolScreen> createState() => _SmartContractEbolScreenState();
}

class _SmartContractEbolScreenState extends State<SmartContractEbolScreen> {
  final SmartContractEbolService _service = SmartContractEbolService();
  EbolSession? _session;

  @override
  void initState() {
    super.initState();
    _service.ebolStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateDeliveryExecution();
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
        title: const Text('eBOL Smart Contract'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final s = _session!;
    bool isComplete = s.transaction?.status.contains('RELEASED') ?? false;

    return Column(
      children: [
        _buildStatusHeader(s.transaction?.status ?? 'Initializing...', isComplete),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildLoadDetailsCard(s),
              const SizedBox(height: 24),
              const Text('SMART CONTRACT CONDITIONS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildConditionRow('Delivery Geofence Breached', s.isGeofenceVerified),
              const SizedBox(height: 8),
              _buildConditionRow('Receiver Digital Signature', s.isReceiverSigned),
              const SizedBox(height: 24),
              const Text('BLOCKCHAIN LEDGER', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              if (s.transaction != null) _buildLedgerCard(s.transaction!, isComplete),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(String status, bool isComplete) {
    Color headerColor = isComplete ? Colors.green[800]! : Colors.blueGrey[800]!;
    IconData icon = isComplete ? Icons.monetization_on : Icons.link;

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
              const Text('BLOCKCHAIN ESCROW', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
          if (!isComplete && status.contains('Executing')) ...[
            const SizedBox(height: 16),
            const LinearProgressIndicator(color: Colors.white, backgroundColor: Colors.white24),
          ]
        ],
      ),
    );
  }

  Widget _buildLoadDetailsCard(EbolSession s) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('LOAD ID', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
                Text(s.loadId, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('CONSIGNEE', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
                Text(s.receiverName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildConditionRow(String label, bool isMet) {
    return Card(
      elevation: 1,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        leading: Icon(
          isMet ? Icons.check_circle : Icons.radio_button_unchecked,
          color: isMet ? Colors.green : Colors.grey,
        ),
        title: Text(label, style: TextStyle(fontWeight: isMet ? FontWeight.bold : FontWeight.normal)),
        trailing: isMet ? const Text('VERIFIED', style: TextStyle(color: Colors.green, fontWeight: FontWeight.bold)) : const Text('PENDING', style: TextStyle(color: Colors.grey)),
      ),
    );
  }

  Widget _buildLedgerCard(BlockchainTransaction t, bool isComplete) {
    return Card(
      elevation: isComplete ? 8 : 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: isComplete ? Colors.green : Colors.blueGrey, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('\$${t.loadPayoutUsd.toStringAsFixed(2)}', style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: isComplete ? Colors.green[800] : Colors.blueGrey)),
                Icon(Icons.account_balance, color: isComplete ? Colors.green : Colors.grey),
              ],
            ),
            const SizedBox(height: 24),
            _buildLedgerDetail('Tx Hash', t.transactionHash),
            const SizedBox(height: 12),
            _buildLedgerDetail('From (Broker/Receiver)', t.receiverWalletAddress),
            const SizedBox(height: 12),
            _buildLedgerDetail('To (Carrier)', t.carrierWalletAddress),
          ],
        ),
      ),
    );
  }

  Widget _buildLedgerDetail(String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
        Text(value, style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.bold)),
      ],
    );
  }
}
