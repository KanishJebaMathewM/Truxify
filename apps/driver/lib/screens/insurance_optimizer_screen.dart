import 'package:flutter/material.dart';
import '../models/telematics_insurance_model.dart';
import '../services/insurance_crypto_service.dart';

class InsuranceOptimizerScreen extends StatefulWidget {
  const InsuranceOptimizerScreen({super.key});

  @override
  State<InsuranceOptimizerScreen> createState() => _InsuranceOptimizerScreenState();
}

class _InsuranceOptimizerScreenState extends State<InsuranceOptimizerScreen> {
  final InsuranceCryptoService _insuranceService = InsuranceCryptoService();
  TelematicsScore? _score;
  CryptoInsuranceReport? _report;
  bool _isLoading = true;
  bool _isSubmitting = false;

  @override
  void initState() {
    super.initState();
    _loadScore();
  }

  void _loadScore() async {
    final score = await _insuranceService.getMonthlyScore();
    if (mounted) {
      setState(() {
        _score = score;
        _isLoading = false;
      });
    }
  }

  void _submitReport() async {
    setState(() => _isSubmitting = true);
    final report = await _insuranceService.generateAndSubmitReport(_score!);
    if (mounted) {
      setState(() {
        _report = report;
        _isSubmitting = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Insurance Premium Optimizer'),
        backgroundColor: Colors.blue[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  _buildScoreCard(),
                  const SizedBox(height: 16),
                  if (_report == null)
                    _buildSubmissionAction()
                  else
                    _buildVerificationReceipt(),
                ],
              ),
            ),
    );
  }

  Widget _buildScoreCard() {
    final s = _score!;
    final isGood = s.score >= 90;

    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: isGood ? Colors.green[50] : Colors.orange[50],
              borderRadius: const BorderRadius.only(topLeft: Radius.circular(12), topRight: Radius.circular(12)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Safety Score', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
                    Row(
                      children: [
                        Text('${s.score}', style: TextStyle(fontSize: 48, fontWeight: FontWeight.bold, color: isGood ? Colors.green[800] : Colors.orange[800])),
                        const Text('/100', style: TextStyle(fontSize: 18, color: Colors.grey)),
                      ],
                    ),
                  ],
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Text('Projected Discount', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
                    Text('${s.projectedDiscountPercentage}%', style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: Colors.blue[800])),
                  ],
                )
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(20.0),
            child: Column(
              children: [
                _buildStatRow('Hard Braking Events', '${s.hardBrakingEvents}'),
                const Divider(),
                _buildStatRow('Speeding Events', '${s.speedingEvents}'),
                const Divider(),
                _buildStatRow('HOS Compliance', '${s.hosComplianceRate}%'),
                const Divider(),
                _buildStatRow('Reporting Period', s.reportPeriod),
              ],
            ),
          )
        ],
      ),
    );
  }

  Widget _buildStatRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(color: Colors.grey[700])),
          Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
        ],
      ),
    );
  }

  Widget _buildSubmissionAction() {
    return Column(
      children: [
        const Text(
          'Opt-in to securely share this anonymized telematics report with your insurance carrier. This data is cryptographically signed to prevent tampering.',
          textAlign: TextAlign.center,
          style: TextStyle(color: Colors.grey),
        ),
        const SizedBox(height: 24),
        SizedBox(
          width: double.infinity,
          height: 56,
          child: ElevatedButton(
            onPressed: _isSubmitting ? null : _submitReport,
            style: ElevatedButton.styleFrom(backgroundColor: Colors.blue[900], foregroundColor: Colors.white),
            child: _isSubmitting
                ? const CircularProgressIndicator(color: Colors.white)
                : const Text('GENERATE & SUBMIT SECURE REPORT', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        )
      ],
    );
  }

  Widget _buildVerificationReceipt() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(color: Colors.blue[50], border: Border.all(color: Colors.blue[200]!), borderRadius: BorderRadius.circular(12)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.verified, color: Colors.blue[800]),
              const SizedBox(width: 8),
              Text('Report Verified & Sent', style: TextStyle(color: Colors.blue[900], fontWeight: FontWeight.bold, fontSize: 18)),
            ],
          ),
          const SizedBox(height: 16),
          Text(_report!.submissionStatus, style: TextStyle(color: Colors.blue[800])),
          const SizedBox(height: 16),
          const Text('Cryptographic Hash (SHA-256):', style: TextStyle(fontSize: 12, color: Colors.grey)),
          Text(_report!.cryptographicHash, style: const TextStyle(fontSize: 10, fontFamily: 'Courier', fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }
}
