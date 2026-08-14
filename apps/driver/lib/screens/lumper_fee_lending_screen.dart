import 'package:flutter/material.dart';
import '../models/lumper_fee_lending_model.dart';
import '../services/lumper_fee_lending_service.dart';

class LumperFeeLendingScreen extends StatefulWidget {
  const LumperFeeLendingScreen({super.key});

  @override
  State<LumperFeeLendingScreen> createState() => _LumperFeeLendingScreenState();
}

class _LumperFeeLendingScreenState extends State<LumperFeeLendingScreen> {
  final LumperFeeLendingService _service = LumperFeeLendingService();
  LumperInvoice? _invoice;
  VirtualDebitCard? _card;
  bool _isProcessing = false;
  String _statusText = '';

  void _scanReceipt() async {
    setState(() {
      _isProcessing = true;
      _statusText = 'Scanning receipt via OCR...';
    });
    
    final invoice = await _service.scanReceiptOCR();
    
    if (mounted) {
      setState(() {
        _invoice = invoice;
        _isProcessing = false;
      });
    }
  }

  void _requestLoan() async {
    setState(() {
      _isProcessing = true;
      _statusText = 'Underwriting micro-loan & issuing virtual card...';
    });

    final card = await _service.issueMicroLoanCard(_invoice!);

    if (mounted) {
      setState(() {
        _card = card;
        _isProcessing = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Lumper Fee Micro-Loan'),
        backgroundColor: Colors.teal[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_isProcessing) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const CircularProgressIndicator(),
            const SizedBox(height: 24),
            Text(_statusText, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          ],
        ),
      );
    }

    if (_invoice == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.receipt_long, size: 100, color: Colors.teal[200]),
              const SizedBox(height: 24),
              const Text('Trapped at the dock?', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              const Text('Scan your lumper receipt to instantly receive a virtual debit card to pay the warehouse. We\'ll deduct it from your load settlement later.', textAlign: TextAlign.center, style: TextStyle(color: Colors.grey)),
              const SizedBox(height: 32),
              SizedBox(
                width: double.infinity,
                height: 56,
                child: ElevatedButton.icon(
                  onPressed: _scanReceipt,
                  icon: const Icon(Icons.document_scanner),
                  label: const Text('SCAN LUMPER RECEIPT'),
                  style: ElevatedButton.styleFrom(backgroundColor: Colors.teal[800], foregroundColor: Colors.white),
                ),
              )
            ],
          ),
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _buildInvoiceSummary(),
        if (_card == null) ...[
          const SizedBox(height: 32),
          SizedBox(
            width: double.infinity,
            height: 56,
            child: ElevatedButton.icon(
              onPressed: _requestLoan,
              icon: const Icon(Icons.credit_card),
              label: const Text('REQUEST MICRO-LOAN'),
              style: ElevatedButton.styleFrom(backgroundColor: Colors.teal[800], foregroundColor: Colors.white),
            ),
          )
        ] else ...[
          const SizedBox(height: 24),
          _buildVirtualCard(),
        ]
      ],
    );
  }

  Widget _buildInvoiceSummary() {
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('LUMPER INVOICE', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
                if (_invoice!.isVerified) const Icon(Icons.verified, color: Colors.green),
              ],
            ),
            const Divider(height: 32),
            Text(_invoice!.warehouseName, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            Text('Load ID: ${_invoice!.loadId}', style: const TextStyle(color: Colors.grey)),
            const SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('FEE AMOUNT', style: TextStyle(fontWeight: FontWeight.bold)),
                Text('\$${_invoice!.feeAmountUsd.toStringAsFixed(2)}', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: Colors.teal)),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildVirtualCard() {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        gradient: LinearGradient(colors: [Colors.teal[800]!, Colors.teal[600]!], begin: Alignment.topLeft, end: Alignment.bottomRight),
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 10, offset: Offset(0, 5))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('TRUXIFY VIRTUAL DEBIT', style: TextStyle(color: Colors.white70, letterSpacing: 1.5, fontWeight: FontWeight.bold)),
              Icon(Icons.contactless, color: Colors.white.withOpacity(0.8)),
            ],
          ),
          const SizedBox(height: 32),
          Text(_card!.cardNumber, style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold, letterSpacing: 2)),
          const SizedBox(height: 24),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('EXP', style: TextStyle(color: Colors.white54, fontSize: 10)),
                  Text(_card!.expiration, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
                ],
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('CVV', style: TextStyle(color: Colors.white54, fontSize: 10)),
                  Text(_card!.cvv, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(12)),
                child: Text('AUTH: \$${_card!.authorizedAmountUsd.toStringAsFixed(2)}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
              )
            ],
          ),
        ],
      ),
    );
  }
}
