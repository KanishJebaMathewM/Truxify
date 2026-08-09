import 'package:flutter/material.dart';
import '../models/carbon_offset_model.dart';
import '../services/carbon_offset_api_service.dart';

class ShipperGreenCheckoutScreen extends StatefulWidget {
  final String loadId;
  const ShipperGreenCheckoutScreen({super.key, this.loadId = 'LD-ESG-7712'});

  @override
  State<ShipperGreenCheckoutScreen> createState() => _ShipperGreenCheckoutScreenState();
}

class _ShipperGreenCheckoutScreenState extends State<ShipperGreenCheckoutScreen> {
  final CarbonOffsetApiService _offsetService = CarbonOffsetApiService();
  CarbonOffsetQuote? _quote;
  bool _isLoading = true;
  bool _isPurchasing = false;
  bool _hasPurchased = false;

  @override
  void initState() {
    super.initState();
    _loadQuote();
  }

  void _loadQuote() async {
    final quote = await _offsetService.calculateLoadEmissions(widget.loadId, 32000, 850);
    if (mounted) {
      setState(() {
        _quote = quote;
        _isLoading = false;
      });
    }
  }

  void _purchaseOffsets() async {
    setState(() {
      _isPurchasing = true;
    });

    final success = await _offsetService.purchaseOffset(widget.loadId, _quote!.offsetCostUsd);

    if (mounted && success) {
      setState(() {
        _isPurchasing = false;
        _hasPurchased = true;
      });
      _showSuccessCertificate();
    }
  }

  void _showSuccessCertificate() {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        backgroundColor: Colors.green[50],
        title: const Row(
          children: [
            Icon(Icons.eco, color: Colors.green, size: 32),
            SizedBox(width: 8),
            Text('Net-Zero Achieved!'),
          ],
        ),
        content: const Text(
          'Your carbon offset purchase is confirmed. A verified Gold Standard certificate has been emailed to your corporate ESG department.',
          style: TextStyle(fontSize: 16),
        ),
        actions: [
          ElevatedButton(
            onPressed: () => Navigator.pop(context),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.green[800], foregroundColor: Colors.white),
            child: const Text('VIEW CERTIFICATE'),
          )
        ],
      )
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Green Freight Checkout'),
        backgroundColor: Colors.green[900],
      ),
      backgroundColor: Colors.grey[100],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _buildCheckoutPanel(),
    );
  }

  Widget _buildCheckoutPanel() {
    return Padding(
      padding: const EdgeInsets.all(24.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Icon(Icons.nature_people, size: 80, color: Colors.green[700]),
          const SizedBox(height: 16),
          const Text(
            'Make Your Shipment Carbon Neutral',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          const Text(
            'Purchase verified carbon offsets directly matching the calculated emissions of your load route.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.grey, fontSize: 16),
          ),
          const SizedBox(height: 32),
          Card(
            elevation: 4,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            child: Padding(
              padding: const EdgeInsets.all(24.0),
              child: Column(
                children: [
                  _buildInvoiceRow('Estimated CO2 Emissions', '${_quote!.estimatedCo2EmissionsKg.toStringAsFixed(0)} kg', Icons.cloud_outlined),
                  const Divider(height: 32),
                  _buildInvoiceRow('Offset Project', _quote!.offsetProjectName, Icons.forest),
                  const Divider(height: 32),
                  _buildInvoiceRow('Certification', _quote!.certificationBody, Icons.verified),
                  const Divider(height: 32),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Total Offset Cost', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                      Text(
                        '\$${_quote!.offsetCostUsd.toStringAsFixed(2)}',
                        style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.green[800]),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const Spacer(),
          if (_hasPurchased)
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: Colors.green[100], borderRadius: BorderRadius.circular(12)),
              child: const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.check_circle, color: Colors.green),
                  SizedBox(width: 8),
                  Text('Offsets Successfully Purchased', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.green)),
                ],
              ),
            )
          else
            SizedBox(
              height: 56,
              child: ElevatedButton.icon(
                onPressed: _isPurchasing ? null : _purchaseOffsets,
                icon: _isPurchasing 
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                    : const Icon(Icons.payment),
                label: Text(_isPurchasing ? 'PROCESSING TRANSACTION...' : 'ADD TO FREIGHT BILL'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.green[800],
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))
                ),
              ),
            )
        ],
      ),
    );
  }

  Widget _buildInvoiceRow(String label, String value, IconData icon) {
    return Row(
      children: [
        Icon(icon, color: Colors.green[700]),
        const SizedBox(width: 12),
        Expanded(child: Text(label, style: const TextStyle(color: Colors.grey, fontSize: 16))),
        Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
      ],
    );
  }
}
