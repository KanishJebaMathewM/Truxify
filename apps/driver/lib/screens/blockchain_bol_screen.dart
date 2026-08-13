import 'package:flutter/material.dart';
import '../models/blockchain_bol_model.dart';
import '../services/blockchain_bol_service.dart';

class BlockchainBolScreen extends StatefulWidget {
  const BlockchainBolScreen({super.key});

  @override
  State<BlockchainBolScreen> createState() => _BlockchainBolScreenState();
}

class _BlockchainBolScreenState extends State<BlockchainBolScreen> {
  final BlockchainBolService _service = BlockchainBolService();
  BlockchainBolSession? _session;
  final TextEditingController _signatureController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _service.bolStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.initializeScanner('LD-PHARMA-992');
  }

  @override
  void dispose() {
    _service.dispose();
    _signatureController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Immutable BOL Ledger'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: (_session?.isHashing == true || _session?.isMinting == true || _session?.finalizedTransaction != null)
            ? null 
            : () => _showSignatureDialog(context),
        backgroundColor: Colors.indigo,
        icon: const Icon(Icons.draw),
        label: const Text('Capture Receiver Signature'),
      ),
    );
  }

  void _showSignatureDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('Sign for Delivery'),
          content: TextField(
            controller: _signatureController,
            decoration: const InputDecoration(hintText: "Enter Receiver's Full Name"),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: () {
                if (_signatureController.text.isNotEmpty) {
                  Navigator.pop(context);
                  _service.signAndMintBol('LD-PHARMA-992', _signatureController.text);
                }
              },
              child: const Text('Sign & Mint to Ledger'),
            )
          ],
        );
      },
    );
  }

  Widget _buildDashboard() {
    final s = _session!;

    return Column(
      children: [
        _buildStatusHeader(s),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (s.finalizedTransaction != null) ...[
                _buildSuccessBanner(),
                const SizedBox(height: 16),
                _buildLedgerCard(s.finalizedTransaction!),
              ] else ...[
                _buildInstructionCard(s),
              ],
              const SizedBox(height: 80), // Padding for FAB
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(BlockchainBolSession s) {
    bool isProcessing = s.isHashing || s.isMinting;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: isProcessing ? Colors.indigo[600] : (s.finalizedTransaction != null ? Colors.green[700] : Colors.blueGrey[800]),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              isProcessing 
                ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3))
                : Icon(s.finalizedTransaction != null ? Icons.verified_user : Icons.security, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('ZERO-TRUST CRYPTO LEDGER', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildInstructionCard(BlockchainBolSession s) {
    return Card(
      elevation: 1,
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const Icon(Icons.qr_code_scanner, size: 64, color: Colors.grey),
            const SizedBox(height: 16),
            const Text('High-Value Freight Delivery', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
            const SizedBox(height: 8),
            Text('Load ID: ${s.loadId}', style: const TextStyle(color: Colors.indigo, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            const Text(
              'Tap the button below to capture the receiver\'s digital signature. The software will hash the signature, your live GPS coordinates, and a timestamp, writing it directly to an immutable ledger to prevent payment disputes.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.grey),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildSuccessBanner() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.green[50], borderRadius: BorderRadius.circular(12), border: Border.all(color: Colors.green, width: 2)),
      child: Row(
        children: [
          const Icon(Icons.check_circle, color: Colors.green, size: 32),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('VERIFIED PROOF OF DELIVERY', style: TextStyle(color: Colors.green[900], fontWeight: FontWeight.bold)),
                Text('This delivery record is cryptographically immutable and cannot be disputed by the broker.', style: TextStyle(color: Colors.green[800], fontSize: 12)),
              ],
            ),
          )
        ],
      ),
    );
  }

  Widget _buildLedgerCard(BlockchainTransaction tx) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('BLOCKCHAIN RECEIPT', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
            const Divider(height: 32),
            _buildLedgerRow('Receiver Sig.', tx.receiverSignatureData, Icons.draw),
            _buildLedgerRow('GPS Location', tx.gpsCoordinates, Icons.satellite_alt),
            _buildLedgerRow('Timestamp', tx.timestamp, Icons.schedule),
            const Divider(height: 32),
            const Text('CRYPTOGRAPHIC HASH (TX ID)', style: TextStyle(color: Colors.grey, fontSize: 10, fontWeight: FontWeight.bold)),
            const SizedBox(height: 4),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(color: Colors.black, borderRadius: BorderRadius.circular(4)),
              child: Text(tx.txHash, style: const TextStyle(color: Colors.greenAccent, fontFamily: 'monospace', fontSize: 10)),
            ),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Block: ${tx.blockNumber}', style: const TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold)),
                Text('Contract: ${tx.smartContractAddress.substring(0, 10)}...', style: const TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold)),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildLedgerRow(String label, String value, IconData icon) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: Colors.indigo),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
                Text(value, style: const TextStyle(fontWeight: FontWeight.bold)),
              ],
            ),
          )
        ],
      ),
    );
  }
}
