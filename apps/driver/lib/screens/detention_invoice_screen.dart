import 'package:flutter/material.dart';
import '../models/detention_invoice_model.dart';
import '../services/detention_invoice_service.dart';

class DetentionInvoiceScreen extends StatefulWidget {
  const DetentionInvoiceScreen({super.key});

  @override
  State<DetentionInvoiceScreen> createState() => _DetentionInvoiceScreenState();
}

class _DetentionInvoiceScreenState extends State<DetentionInvoiceScreen> {
  final DetentionInvoiceService _service = DetentionInvoiceService();
  DetentionInvoiceSession? _session;

  @override
  void initState() {
    super.initState();
    _service.invoiceStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.startGeofenceTimer();
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
        title: const Text('Auto-Detention Pay'),
        backgroundColor: Colors.blueGrey[900],
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
              if (s.activeEvent != null) ...[
                _buildTimerCard(s.activeEvent!),
                const SizedBox(height: 24),
                const Text('WORKFLOW AUTOMATION', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                const SizedBox(height: 12),
                _buildWorkflowCard(s.activeEvent!),
              ]
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(DetentionInvoiceSession s) {
    bool isTriggered = s.activeEvent?.isInvoiceGenerated ?? false;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: isTriggered ? Colors.green[800] : Colors.blueGrey[800],
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(isTriggered ? Icons.mark_email_read : Icons.timer, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('ACCOUNTS RECEIVABLE AI', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildTimerCard(DetentionEvent event) {
    bool isOvertime = event.currentWaitHours >= 2.0;
    
    return Card(
      elevation: isOvertime ? 8 : 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: isOvertime ? Colors.green : Colors.transparent, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            Text(event.facilityName, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.blueGrey)),
            const Divider(height: 32),
            Stack(
              alignment: Alignment.center,
              children: [
                SizedBox(
                  width: 160,
                  height: 160,
                  child: CircularProgressIndicator(
                    value: (event.currentWaitHours / 2.0).clamp(0.0, 1.0),
                    backgroundColor: Colors.grey[200],
                    color: isOvertime ? Colors.green : Colors.blue,
                    strokeWidth: 12,
                  ),
                ),
                Column(
                  children: [
                    Text(
                      '${event.currentWaitHours.toStringAsFixed(1)}h',
                      style: TextStyle(fontSize: 48, fontWeight: FontWeight.bold, color: isOvertime ? Colors.green : Colors.blueGrey[900]),
                    ),
                    const Text('Total Wait', style: TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold)),
                  ],
                ),
              ],
            ),
            if (isOvertime) ...[
              const SizedBox(height: 24),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                decoration: BoxDecoration(color: Colors.green[50], borderRadius: BorderRadius.circular(12)),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.attach_money, color: Colors.green),
                    Text('Accrued: \$${event.estimatedPayout.toStringAsFixed(2)}', style: TextStyle(color: Colors.green[800], fontSize: 20, fontWeight: FontWeight.bold)),
                  ],
                ),
              )
            ]
          ],
        ),
      ),
    );
  }

  Widget _buildWorkflowCard(DetentionEvent event) {
    bool isGenerated = event.isInvoiceGenerated;

    return Card(
      elevation: 1,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            _buildWorkflowStep(Icons.gps_fixed, 'Geofence Entry Logged', true),
            _buildWorkflowStep(Icons.timer_off, '2-Hour Free Time Expired', isGenerated),
            _buildWorkflowStep(Icons.picture_as_pdf, 'Generate PDF Invoice (\$65/hr)', isGenerated),
            _buildWorkflowStep(Icons.send, 'Email to ${event.brokerEmail}', isGenerated, isLast: true),
          ],
        ),
      ),
    );
  }

  Widget _buildWorkflowStep(IconData icon, String label, bool isComplete, {bool isLast = false}) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Column(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: isComplete ? Colors.green : Colors.grey[300],
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: Colors.white, size: 20),
            ),
            if (!isLast)
              Container(
                width: 2,
                height: 30,
                color: isComplete ? Colors.green : Colors.grey[300],
              )
          ],
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              label,
              style: TextStyle(
                fontSize: 16,
                fontWeight: isComplete ? FontWeight.bold : FontWeight.normal,
                color: isComplete ? Colors.black87 : Colors.grey,
              ),
            ),
          ),
        )
      ],
    );
  }
}
