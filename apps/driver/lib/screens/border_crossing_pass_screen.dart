import 'package:flutter/material.dart';
import '../models/customs_emanifest_model.dart';
import '../services/customs_broker_service.dart';

class BorderCrossingPassScreen extends StatefulWidget {
  final String loadReference;
  final String destinationCountry;
  final String portOfEntry;

  const BorderCrossingPassScreen({
    super.key,
    required this.loadReference,
    required this.destinationCountry,
    required this.portOfEntry,
  });

  @override
  State<BorderCrossingPassScreen> createState() => _BorderCrossingPassScreenState();
}

class _BorderCrossingPassScreenState extends State<BorderCrossingPassScreen> {
  final CustomsBrokerService _brokerService = CustomsBrokerService();
  CustomsEmanifest? _manifest;
  bool _isFiling = false;

  Future<void> _fileManifest() async {
    setState(() {
      _isFiling = true;
    });

    final manifest = await _brokerService.fileElectronicManifest(
      loadReference: widget.loadReference,
      destinationCountry: widget.destinationCountry,
      portOfEntry: widget.portOfEntry,
    );

    if (mounted) {
      setState(() {
        _manifest = manifest;
        _isFiling = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Border Crossing Pass'),
        backgroundColor: Colors.indigo[900],
      ),
      body: _manifest == null ? _buildFilingPrompt() : _buildApprovedPass(),
    );
  }

  Widget _buildFilingPrompt() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.public, size: 80, color: Colors.indigo),
            const SizedBox(height: 24),
            Text('Cross-Border Freight: ${widget.loadReference}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            Text('Destination: ${widget.destinationCountry} via ${widget.portOfEntry}', style: const TextStyle(fontSize: 16, color: Colors.grey)),
            const SizedBox(height: 32),
            if (_isFiling)
              const CircularProgressIndicator()
            else
              SizedBox(
                width: double.infinity,
                height: 54,
                child: ElevatedButton.icon(
                  onPressed: _fileManifest,
                  icon: const Icon(Icons.send),
                  label: const Text('FILE eMANIFEST TO CUSTOMS', style: TextStyle(fontWeight: FontWeight.bold)),
                  style: ElevatedButton.styleFrom(backgroundColor: Colors.indigo, foregroundColor: Colors.white),
                ),
              )
          ],
        ),
      ),
    );
  }

  Widget _buildApprovedPass() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: Colors.green[100], borderRadius: BorderRadius.circular(12)),
            child: Row(
              children: [
                const Icon(Icons.check_circle, color: Colors.green, size: 32),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${_manifest!.borderAgency} eManifest Approved', style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.green)),
                      Text('Cleared for border crossing', style: TextStyle(color: Colors.green[800])),
                    ],
                  ),
                )
              ],
            ),
          ),
          const SizedBox(height: 32),
          
          Card(
            elevation: 4,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            child: Padding(
              padding: const EdgeInsets.all(32.0),
              child: Column(
                children: [
                  const Text('Present at Border Checkpoint', style: TextStyle(fontSize: 18, color: Colors.grey, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 24),
                  
                  // Mock Barcode UI
                  Container(
                    height: 100,
                    width: double.infinity,
                    color: Colors.black,
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                      children: List.generate(30, (index) => Container(
                        width: index % 2 == 0 ? 3 : 7,
                        color: Colors.white,
                      )),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(_manifest!.barcodeData, style: const TextStyle(letterSpacing: 2, fontWeight: FontWeight.bold, fontSize: 16)),
                  
                  const SizedBox(height: 32),
                  const Divider(),
                  const SizedBox(height: 16),
                  
                  _buildDetailRow('Manifest ID', _manifest!.manifestId),
                  _buildDetailRow('Port of Entry', _manifest!.portOfEntry),
                  _buildDetailRow('Filing Time', '${_manifest!.submissionTime.hour}:${_manifest!.submissionTime.minute.toString().padLeft(2, '0')}'),
                ],
              ),
            ),
          )
        ],
      ),
    );
  }

  Widget _buildDetailRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: Colors.grey, fontSize: 16)),
          Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
        ],
      ),
    );
  }
}
