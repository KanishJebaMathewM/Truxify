import 'package:flutter/material.dart';
import '../models/geofenced_ebol_model.dart';
import '../services/geofenced_ebol_service.dart';

class GeofencedEbolScreen extends StatefulWidget {
  const GeofencedEbolScreen({super.key});

  @override
  State<GeofencedEbolScreen> createState() => _GeofencedEbolScreenState();
}

class _GeofencedEbolScreenState extends State<GeofencedEbolScreen> {
  final GeofencedEbolService _service = GeofencedEbolService();
  EbolDocument? _document;
  bool _isVerifying = false;
  bool _isSigning = false;

  @override
  void initState() {
    super.initState();
    _loadDocument();
  }

  void _loadDocument() async {
    final doc = await _service.getActiveBol();
    if (mounted) setState(() => _document = doc);
  }

  void _verifyLocation() async {
    setState(() => _isVerifying = true);
    
    final isValid = await _service.verifyGeofence(_document!.deliveryLocation);
    
    if (mounted) {
      setState(() {
        _isVerifying = false;
        _document = _document!.copyWith(isGeofenceVerified: isValid);
      });
    }
  }

  void _signDocument() async {
    setState(() => _isSigning = true);

    final hash = await _service.submitSignature(_document!.bolId, 'John Doe (Dock Manager)');

    if (mounted) {
      setState(() {
        _isSigning = false;
        _document = _document!.copyWith(
          isSigned: true,
          signedAt: DateTime.now(),
          signatureHash: hash,
        );
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_document == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Smart eBOL'),
        backgroundColor: Colors.indigo[900],
      ),
      backgroundColor: Colors.grey[100],
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            _buildDocumentHeader(),
            const SizedBox(height: 16),
            _buildGeofenceStatusCard(),
            const SizedBox(height: 16),
            if (_document!.isGeofenceVerified && !_document!.isSigned) _buildSignaturePad(),
            if (_document!.isSigned) _buildSignedReceipt(),
          ],
        ),
      ),
    );
  }

  Widget _buildDocumentHeader() {
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('BILL OF LADING', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
                Text(_document!.bolId, style: const TextStyle(fontWeight: FontWeight.bold)),
              ],
            ),
            const Divider(height: 24),
            Text(_document!.loadDescription, style: const TextStyle(fontSize: 18)),
            const SizedBox(height: 16),
            const Row(
              children: [
                Icon(Icons.location_on, color: Colors.indigo),
                SizedBox(width: 8),
                Text('Delivery Facility:', style: TextStyle(fontWeight: FontWeight.bold)),
              ],
            ),
            Padding(
              padding: const EdgeInsets.only(left: 32, top: 4),
              child: Text(_document!.deliveryLocation.facilityName, style: const TextStyle(color: Colors.grey)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildGeofenceStatusCard() {
    final isVerified = _document!.isGeofenceVerified;
    return Card(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: isVerified ? Colors.green : Colors.orange, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          children: [
            Row(
              children: [
                Icon(isVerified ? Icons.gps_fixed : Icons.gps_not_fixed, color: isVerified ? Colors.green : Colors.orange, size: 32),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        isVerified ? 'GEOFENCE VERIFIED' : 'GEOFENCE PENDING',
                        style: TextStyle(fontWeight: FontWeight.bold, color: isVerified ? Colors.green : Colors.orange),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        isVerified 
                            ? 'Device GPS confirmed inside facility perimeter.' 
                            : 'Signatures are locked until GPS verifies location.',
                        style: const TextStyle(color: Colors.grey, fontSize: 12),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            if (!isVerified) ...[
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: _isVerifying ? null : _verifyLocation,
                  icon: _isVerifying ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.satellite_alt),
                  label: const Text('VERIFY GPS LOCATION'),
                  style: ElevatedButton.styleFrom(backgroundColor: Colors.indigo[900], foregroundColor: Colors.white),
                ),
              )
            ]
          ],
        ),
      ),
    );
  }

  Widget _buildSignaturePad() {
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.draw, color: Colors.indigo),
                SizedBox(width: 8),
                Text('Receiver Signature', style: TextStyle(fontWeight: FontWeight.bold)),
              ],
            ),
            const SizedBox(height: 16),
            Container(
              height: 150,
              width: double.infinity,
              decoration: BoxDecoration(
                color: Colors.grey[200],
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: Colors.grey[400]!),
              ),
              child: const Center(child: Text('Sign Here (Receiver Only)', style: TextStyle(color: Colors.grey))),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              height: 50,
              child: ElevatedButton(
                onPressed: _isSigning ? null : _signDocument,
                style: ElevatedButton.styleFrom(backgroundColor: Colors.green, foregroundColor: Colors.white),
                child: _isSigning 
                    ? const CircularProgressIndicator(color: Colors.white) 
                    : const Text('SUBMIT SECURE SIGNATURE', style: TextStyle(fontWeight: FontWeight.bold)),
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildSignedReceipt() {
    return Card(
      color: Colors.green[50],
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: const BorderSide(color: Colors.green, width: 2)),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          children: [
            const Icon(Icons.verified, color: Colors.green, size: 48),
            const SizedBox(height: 8),
            const Text('LEGALLY BINDING HASH', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.green)),
            const Divider(height: 24),
            Text('Signed at: ${_document!.signedAt.toString().split('.')[0]}', style: const TextStyle(color: Colors.grey)),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(8),
              color: Colors.white,
              child: Text(_document!.signatureHash!, style: const TextStyle(fontFamily: 'monospace', fontSize: 12)),
            )
          ],
        ),
      ),
    );
  }
}
