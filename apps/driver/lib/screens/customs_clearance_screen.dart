import 'package:flutter/material.dart';
import '../models/customs_clearance_model.dart';
import '../services/customs_clearance_service.dart';

class CustomsClearanceScreen extends StatefulWidget {
  const CustomsClearanceScreen({super.key});

  @override
  State<CustomsClearanceScreen> createState() => _CustomsClearanceScreenState();
}

class _CustomsClearanceScreenState extends State<CustomsClearanceScreen> {
  final CustomsClearanceService _service = CustomsClearanceService();
  CustomsClearanceSession? _session;

  @override
  void initState() {
    super.initState();
    _service.clearanceStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateClearance();
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
        title: const Text('CBP ACE Pre-Clearance'),
        backgroundColor: Colors.indigo[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
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
              _buildCrossingCard(s),
              const SizedBox(height: 24),
              const Text('DIGITAL MANIFEST STATUS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              ...s.documents.map((doc) => _buildDocumentCard(doc)),
              if (s.isCleared) ...[
                const SizedBox(height: 24),
                _buildBarcodeCard(s.fastLaneBarcode!),
              ]
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(CustomsClearanceSession s) {
    Color headerColor = s.isCleared ? Colors.green[800]! : Colors.indigo[800]!;
    IconData icon = s.isCleared ? Icons.fact_check : Icons.sync;

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
              const Text('CBP API INTEGRATION', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildCrossingCard(CustomsClearanceSession s) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const Text('BORDER CROSSING', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.flag, color: Colors.indigo[900], size: 32),
                const SizedBox(width: 12),
                Expanded(child: Text(s.borderCrossing, style: TextStyle(color: Colors.indigo[900], fontSize: 18, fontWeight: FontWeight.bold))),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildDocumentCard(CustomsDocument doc) {
    bool isVerified = doc.status == 'Verified';
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      elevation: 1,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        leading: Icon(
          isVerified ? Icons.check_circle : Icons.hourglass_empty,
          color: isVerified ? Colors.green : Colors.grey,
        ),
        title: Text(doc.documentType, style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Text(doc.documentId, style: const TextStyle(fontFamily: 'monospace', fontSize: 12)),
        trailing: Text(
          doc.status,
          style: TextStyle(
            color: isVerified ? Colors.green : Colors.orange[800],
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
    );
  }

  Widget _buildBarcodeCard(String barcode) {
    return Card(
      elevation: 8,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Colors.green, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          children: [
            const Text('FAST LANE CLEARANCE', style: TextStyle(color: Colors.green, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            const SizedBox(height: 24),
            // Mock barcode visualization
            Container(
              height: 100,
              width: double.infinity,
              decoration: const BoxDecoration(
                image: DecorationImage(
                  image: NetworkImage('https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/UPC-A-036000291452.svg/1200px-UPC-A-036000291452.svg.png'), // generic barcode
                  fit: BoxFit.contain,
                )
              ),
            ),
            const SizedBox(height: 12),
            Text(barcode, style: const TextStyle(fontFamily: 'monospace', fontSize: 20, letterSpacing: 4)),
            const SizedBox(height: 24),
            const Text('Present to CBP Agent at Booth', style: TextStyle(color: Colors.grey)),
          ],
        ),
      ),
    );
  }
}
