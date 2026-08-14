import 'package:flutter/material.dart';
import '../models/dot_compliance_predictor_model.dart';
import '../services/dot_compliance_predictor_service.dart';

class DotCompliancePredictorScreen extends StatefulWidget {
  const DotCompliancePredictorScreen({super.key});

  @override
  State<DotCompliancePredictorScreen> createState() => _DotCompliancePredictorScreenState();
}

class _DotCompliancePredictorScreenState extends State<DotCompliancePredictorScreen> {
  final DotCompliancePredictorService _service = DotCompliancePredictorService();
  List<ComplianceDocument>? _documents;
  bool _isBooking = false;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  void _loadData() async {
    final docs = await _service.getComplianceStatus();
    if (mounted) setState(() => _documents = docs);
  }

  void _bookClinic(ClinicOption clinic) async {
    setState(() => _isBooking = true);
    final success = await _service.bookAppointment(clinic.clinicName);
    
    if (mounted) {
      setState(() => _isBooking = false);
      if (success) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Appointment booked at ${clinic.clinicName}!'), backgroundColor: Colors.green),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Compliance Predictor'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[100],
      body: _documents == null 
        ? const Center(child: CircularProgressIndicator()) 
        : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _documents!.length,
      itemBuilder: (context, index) {
        return _buildDocumentCard(_documents![index]);
      },
    );
  }

  Widget _buildDocumentCard(ComplianceDocument doc) {
    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      elevation: doc.isWarningActive ? 4 : 1,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: doc.isWarningActive ? Colors.red : Colors.transparent, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  doc.isWarningActive ? Icons.warning_amber_rounded : Icons.verified_user,
                  color: doc.isWarningActive ? Colors.red : Colors.green,
                  size: 28,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(doc.documentType, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                      Text('Expires in ${doc.daysRemaining} days', style: TextStyle(color: doc.isWarningActive ? Colors.red : Colors.grey[600], fontWeight: doc.isWarningActive ? FontWeight.bold : FontWeight.normal)),
                    ],
                  ),
                ),
              ],
            ),
            if (doc.isWarningActive && doc.suggestedClinics != null) ...[
              const Divider(height: 32),
              const Text('ACTION REQUIRED: SCHEDULE PHYSICAL', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.red)),
              const SizedBox(height: 8),
              const Text('We found DOT-certified clinics along your current route to minimize downtime:', style: TextStyle(color: Colors.grey, fontSize: 12)),
              const SizedBox(height: 16),
              ...doc.suggestedClinics!.map((clinic) => _buildClinicOption(clinic)),
            ]
          ],
        ),
      ),
    );
  }

  Widget _buildClinicOption(ClinicOption clinic) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: Colors.red[50], borderRadius: BorderRadius.circular(8), border: Border.all(color: Colors.red[200]!)),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(clinic.clinicName, style: const TextStyle(fontWeight: FontWeight.bold)),
                Text('${clinic.location} • ${clinic.distanceMiles}mi ahead', style: const TextStyle(color: Colors.black87, fontSize: 12)),
                Text('+${clinic.deviationFromRouteMiles} mi off-route', style: const TextStyle(color: Colors.red, fontSize: 12)),
              ],
            ),
          ),
          ElevatedButton(
            onPressed: _isBooking ? null : () => _bookClinic(clinic),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red[700], foregroundColor: Colors.white),
            child: const Text('BOOK'),
          )
        ],
      ),
    );
  }
}
