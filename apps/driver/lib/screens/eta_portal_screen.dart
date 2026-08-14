import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import '../models/eta_portal_model.dart';
import '../services/eta_portal_service.dart';

class EtaPortalScreen extends StatefulWidget {
  const EtaPortalScreen({super.key});

  @override
  State<EtaPortalScreen> createState() => _EtaPortalScreenState();
}

class _EtaPortalScreenState extends State<EtaPortalScreen> {
  final EtaPortalService _service = EtaPortalService();
  PortalState? _session;

  @override
  void initState() {
    super.initState();
    _service.portalStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.initializePortal();
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
        title: const Text('Live Tracking Portal'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _session?.isGeneratingLink == true ? null : () => _service.generateTrackingLink(),
        backgroundColor: Colors.indigo,
        icon: const Icon(Icons.share),
        label: const Text('Generate Tracking Link'),
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
              if (s.secureTrackingUrl != null) ...[
                _buildLinkCard(s),
                const SizedBox(height: 24),
                _buildLiveTelemetryPreview(s),
              ] else ...[
                const Center(child: Padding(
                  padding: EdgeInsets.all(32.0),
                  child: Text('Tap generate to create a secure link for the receiver.', style: TextStyle(color: Colors.grey)),
                ))
              ],
              const SizedBox(height: 80), // Padding for FAB
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(PortalState s) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: s.isGeneratingLink ? Colors.indigo[600] : Colors.blueGrey[800],
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              s.isGeneratingLink 
                ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3))
                : const Icon(Icons.public, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('EPHEMERAL PORTAL ENGINE', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildLinkCard(PortalState s) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: Colors.indigo, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            const Row(
              children: [
                Icon(Icons.link, color: Colors.indigo),
                SizedBox(width: 12),
                Text('Secure Sharing Details', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
              ],
            ),
            const Divider(height: 32),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: Colors.grey[100], borderRadius: BorderRadius.circular(8)),
              child: Row(
                children: [
                  const Icon(Icons.language, color: Colors.grey),
                  const SizedBox(width: 12),
                  Expanded(child: Text(s.secureTrackingUrl!, style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.indigo))),
                  IconButton(
                    icon: const Icon(Icons.copy),
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: s.secureTrackingUrl!));
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('URL copied to clipboard')));
                    },
                  )
                ],
              ),
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: Colors.orange[50], borderRadius: BorderRadius.circular(8)),
              child: Row(
                children: [
                  const Icon(Icons.lock, color: Colors.orange),
                  const SizedBox(width: 12),
                  Expanded(child: Text('PIN: ${s.generatedPassword!}', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.orange[900], fontSize: 18))),
                  IconButton(
                    icon: const Icon(Icons.copy),
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: s.generatedPassword!));
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Password copied to clipboard')));
                    },
                  )
                ],
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildLiveTelemetryPreview(PortalState s) {
    return Card(
      elevation: 1,
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('WHAT THE RECEIVER SEES (LIVE DATA)', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, fontSize: 12)),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _buildMetric('Traffic-Aware ETA', DateFormat('h:mm a').format(s.estimatedTimeOfArrival!), Colors.green),
                _buildMetric('Distance', '${s.milesRemaining} mi', Colors.indigo),
              ],
            ),
            const SizedBox(height: 24),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: Colors.red[50], borderRadius: BorderRadius.circular(8)),
              child: Row(
                children: [
                  const Icon(Icons.traffic, color: Colors.red),
                  const SizedBox(width: 12),
                  Expanded(child: Text(s.trafficConditions!, style: TextStyle(color: Colors.red[900], fontWeight: FontWeight.bold))),
                ],
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildMetric(String label, String value, Color color) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(value, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 24, color: color)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }
}
