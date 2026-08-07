import 'package:flutter/material.dart';
import '../models/customs_manifest_model.dart';
import '../services/customs_api_service.dart';

class BorderPreclearanceScreen extends StatefulWidget {
  const BorderPreclearanceScreen({super.key});

  @override
  State<BorderPreclearanceScreen> createState() => _BorderPreclearanceScreenState();
}

class _BorderPreclearanceScreenState extends State<BorderPreclearanceScreen> {
  final CustomsApiService _customsService = CustomsApiService();
  CustomsManifest? _manifest;
  bool _isLoading = true;
  bool _isPolling = false;

  @override
  void initState() {
    super.initState();
    _loadInitialManifest();
  }

  void _loadInitialManifest() async {
    final manifest = await _customsService.getManifestStatus('TRUX-09921');
    if (mounted) {
      setState(() {
        _manifest = manifest;
        _isLoading = false;
      });
      _startPollingForApproval(manifest);
    }
  }

  void _startPollingForApproval(CustomsManifest currentManifest) async {
    if (currentManifest.status == 'Accepted - Pre-cleared') return;
    
    setState(() => _isPolling = true);
    final approvedManifest = await _customsService.pollForPreclearance(currentManifest);
    
    if (mounted) {
      setState(() {
        _manifest = approvedManifest;
        _isPolling = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('eManifest Pre-Clearance'),
        backgroundColor: Colors.teal[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                _buildStatusBanner(),
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      _buildManifestDetailsCard(),
                      const SizedBox(height: 16),
                      if (_manifest!.status == 'Accepted - Pre-cleared')
                        _buildFastLaneInstructions(),
                    ],
                  ),
                )
              ],
            ),
    );
  }

  Widget _buildStatusBanner() {
    final isCleared = _manifest!.status == 'Accepted - Pre-cleared';
    final bgColor = isCleared ? Colors.green[700] : Colors.orange[800];
    final icon = isCleared ? Icons.verified_user : Icons.sync;
    
    return Container(
      width: double.infinity,
      color: bgColor,
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
      child: Column(
        children: [
          Icon(icon, size: 64, color: Colors.white),
          const SizedBox(height: 16),
          Text(_manifest!.status.toUpperCase(), style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
          const SizedBox(height: 8),
          Text(
            isCleared ? 'You are cleared to cross the border.' : 'Awaiting response from ${_manifest!.borderAgency}...',
            style: const TextStyle(color: Colors.white70, fontSize: 16),
            textAlign: TextAlign.center,
          )
        ],
      ),
    );
  }

  Widget _buildManifestDetailsCard() {
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(20.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('MANIFEST DETAILS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
            const Divider(height: 24),
            _buildDetailRow('Port of Entry', _manifest!.portOfEntry),
            _buildDetailRow('Agency', _manifest!.borderAgency),
            _buildDetailRow('Trip Number', _manifest!.tripNumber),
            _buildDetailRow('SCAC Code', _manifest!.scacCode),
            const Divider(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('eManifest ID', style: TextStyle(fontWeight: FontWeight.bold)),
                Text(_manifest!.manifestId, style: const TextStyle(fontFamily: 'Courier', fontWeight: FontWeight.bold, fontSize: 16)),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildDetailRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: Colors.grey)),
          Text(value, style: const TextStyle(fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildFastLaneInstructions() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.green[50],
        border: Border.all(color: Colors.green[200]!),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.directions_car, color: Colors.green[800]),
              const SizedBox(width: 8),
              Text('FAST Lane Approved', style: TextStyle(color: Colors.green[900], fontWeight: FontWeight.bold, fontSize: 18)),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            'Your ACE eManifest has been accepted by US Customs and Border Protection. Proceed directly to the FAST/Pre-cleared commercial lane at the bridge. Have your FAST card ready for the agent.',
            style: TextStyle(color: Colors.green[900], height: 1.5),
          )
        ],
      ),
    );
  }
}
