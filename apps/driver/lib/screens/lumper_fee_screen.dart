import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/lumper_fee_model.dart';
import '../services/lumper_fee_service.dart';

class LumperFeeScreen extends StatefulWidget {
  const LumperFeeScreen({super.key});

  @override
  State<LumperFeeScreen> createState() => _LumperFeeScreenState();
}

class _LumperFeeScreenState extends State<LumperFeeScreen> {
  final LumperFeeService _service = LumperFeeService();
  LumperFeeSession? _session;

  @override
  void initState() {
    super.initState();
    _service.lumperStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.initializeScanner();
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
        title: const Text('Lumper Fee Reimbursement'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: (_session?.isProcessing == true || _session?.activeTicket != null)
            ? null 
            : () => _service.processReceiptUpload(),
        backgroundColor: Colors.indigo,
        icon: const Icon(Icons.camera_alt),
        label: const Text('Scan Lumper Receipt'),
      ),
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
              if (s.scannedReceipt != null) ...[
                _buildOCRCard(s.scannedReceipt!),
                const SizedBox(height: 16),
              ],
              if (s.activeTicket != null) ...[
                _buildTicketCard(s.activeTicket!),
              ] else if (s.scannedReceipt == null) ...[
                _buildInstructionCard(),
              ],
              const SizedBox(height: 80), // Padding for FAB
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(LumperFeeSession s) {
    bool isComplete = s.activeTicket != null;
    
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: s.isProcessing ? Colors.indigo[600] : (isComplete ? Colors.green[700] : Colors.blueGrey[800]),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              s.isProcessing 
                ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3))
                : Icon(isComplete ? Icons.check_circle : Icons.receipt_long, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('ACCOUNTS RECEIVABLE ENGINE', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildInstructionCard() {
    return Card(
      elevation: 1,
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const Icon(Icons.upload_file, size: 64, color: Colors.grey),
            const SizedBox(height: 16),
            const Text('Automated B2B Reimbursement', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
            const SizedBox(height: 16),
            const Text(
              'Tap below to scan your warehouse lumper receipt. The system will OCR the total amount, generate a formal PDF invoice, and instantly fire a webhook to the broker\'s accounting department.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.grey),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildOCRCard(LumperReceipt receipt) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8), side: BorderSide(color: Colors.grey[300]!)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('OCR EXTRACTION RESULTS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, fontSize: 12)),
                Text('Confidence: ${receipt.ocrConfidence}', style: const TextStyle(color: Colors.green, fontWeight: FontWeight.bold, fontSize: 12)),
              ],
            ),
            const Divider(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(receipt.warehouseName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                    Text('Load ID: ${receipt.loadId}', style: const TextStyle(color: Colors.grey, fontSize: 12)),
                  ],
                ),
                Text('\$${receipt.amountPaid.toStringAsFixed(2)}', style: TextStyle(color: Colors.indigo[900], fontWeight: FontWeight.bold, fontSize: 24)),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildTicketCard(ReimbursementTicket ticket) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: Colors.indigo, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.send, color: Colors.indigo),
                SizedBox(width: 12),
                Text('WEBHOOK SUCCESSFULLY FIRED', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.indigo)),
              ],
            ),
            const Divider(height: 32),
            _buildTicketRow('A/R Ticket ID', ticket.ticketId),
            const SizedBox(height: 12),
            _buildTicketRow('Broker API Endpoint', ticket.brokerApiEndpoint),
            const SizedBox(height: 12),
            _buildTicketRow('Timestamp', DateFormat('yyyy-MM-dd HH:mm:ss').format(DateTime.parse(ticket.timestamp))),
            const Divider(height: 32),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: Colors.orange[50], borderRadius: BorderRadius.circular(8)),
              child: Row(
                children: [
                  const Icon(Icons.pending_actions, color: Colors.orange),
                  const SizedBox(width: 12),
                  Text('STATUS: ${ticket.status.toUpperCase()}', style: TextStyle(color: Colors.orange[900], fontWeight: FontWeight.bold)),
                ],
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildTicketRow(String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
        Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
      ],
    );
  }
}
