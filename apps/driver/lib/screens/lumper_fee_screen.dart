import 'package:flutter/material.dart';
import '../models/lumper_escrow_model.dart';
import '../services/lumper_escrow_service.dart';

class LumperFeeScreen extends StatefulWidget {
  final String loadId;
  const LumperFeeScreen({super.key, required this.loadId});

  @override
  State<LumperFeeScreen> createState() => _LumperFeeScreenState();
}

class _LumperFeeScreenState extends State<LumperFeeScreen> {
  final LumperEscrowService _contractService = LumperEscrowService();
  LumperEscrowContract? _contract;
  bool _isLoading = true;
  bool _isProcessingReceipt = false;
  bool _isFundsReleased = false;

  @override
  void initState() {
    super.initState();
    _loadContract();
  }

  void _loadContract() async {
    final contract = await _contractService.getActiveContract(widget.loadId);
    if (mounted) {
      setState(() {
        _contract = contract;
        _isLoading = false;
      });
    }
  }

  void _uploadReceipt() async {
    setState(() {
      _isProcessingReceipt = true;
    });

    final success = await _contractService.processReceiptAndReleaseFunds('mock_receipt.jpg');

    if (mounted) {
      setState(() {
        _isProcessingReceipt = false;
        _isFundsReleased = success;
        if (success) {
           _contract = LumperEscrowContract(
              contractAddress: _contract!.contractAddress,
              loadId: _contract!.loadId,
              brokerName: _contract!.brokerName,
              facilityName: _contract!.facilityName,
              escrowedAmount: _contract!.escrowedAmount,
              status: 'Released',
            );
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Lumper Fee Escrow'),
        backgroundColor: Colors.purple[800],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                children: [
                  _buildContractDetails(),
                  const SizedBox(height: 24),
                  if (!_isFundsReleased) _buildUploadSection() else _buildSuccessSection(),
                ],
              ),
            ),
    );
  }

  Widget _buildContractDetails() {
    final c = _contract!;
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Smart Contract', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  decoration: BoxDecoration(
                    color: c.status == 'Locked' ? Colors.orange[100] : Colors.green[100],
                    borderRadius: BorderRadius.circular(12)
                  ),
                  child: Text(
                    c.status.toUpperCase(),
                    style: TextStyle(
                      color: c.status == 'Locked' ? Colors.orange[800] : Colors.green[800],
                      fontWeight: FontWeight.bold,
                      fontSize: 12
                    )
                  ),
                )
              ],
            ),
            const SizedBox(height: 8),
            Text(c.contractAddress, style: const TextStyle(fontFamily: 'monospace', fontSize: 16)),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Broker Escrow', style: TextStyle(color: Colors.grey, fontSize: 12)),
                    Text('\$${c.escrowedAmount.toStringAsFixed(2)}', style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: Colors.purple[800])),
                  ],
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Text('Facility', style: TextStyle(color: Colors.grey, fontSize: 12)),
                    Text(c.facilityName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  ],
                )
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildUploadSection() {
    if (_isProcessingReceipt) {
      return Container(
        padding: const EdgeInsets.all(32),
        width: double.infinity,
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
        child: Column(
          children: [
            const CircularProgressIndicator(color: Colors.purple),
            const SizedBox(height: 24),
            Text('AI Verifying Lumper Receipt...', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.purple[800])),
            const SizedBox(height: 8),
            const Text('Executing Smart Contract...', style: TextStyle(color: Colors.grey)),
          ],
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(24),
      width: double.infinity,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.purple[200]!, width: 2, style: BorderStyle.solid) // Mock dashed border
      ),
      child: Column(
        children: [
          Icon(Icons.receipt_long, size: 64, color: Colors.purple[300]),
          const SizedBox(height: 16),
          const Text('Upload Lumper Receipt', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          const Text('AI will parse the amount and instantly release the funds from escrow to your wallet.', textAlign: TextAlign.center, style: TextStyle(color: Colors.grey)),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            height: 50,
            child: ElevatedButton.icon(
              onPressed: _uploadReceipt,
              icon: const Icon(Icons.camera_alt),
              label: const Text('SCAN RECEIPT', style: TextStyle(fontWeight: FontWeight.bold)),
              style: ElevatedButton.styleFrom(backgroundColor: Colors.purple[800], foregroundColor: Colors.white),
            ),
          )
        ],
      ),
    );
  }

  Widget _buildSuccessSection() {
    return Container(
      padding: const EdgeInsets.all(32),
      width: double.infinity,
      decoration: BoxDecoration(color: Colors.green[50], borderRadius: BorderRadius.circular(16), border: Border.all(color: Colors.green[200]!)),
      child: Column(
        children: [
          const Icon(Icons.check_circle, size: 80, color: Colors.green),
          const SizedBox(height: 16),
          Text('Funds Released!', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.green[800])),
          const SizedBox(height: 8),
          const Text('The smart contract has verified the receipt and transferred \$350.00 to your wallet.', textAlign: TextAlign.center, style: TextStyle(color: Colors.grey)),
        ],
      ),
    );
  }
}
