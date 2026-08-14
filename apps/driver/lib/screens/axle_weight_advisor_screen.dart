import 'package:flutter/material.dart';
import '../models/axle_weight_advisor_model.dart';
import '../services/axle_weight_advisor_service.dart';

class AxleWeightAdvisorScreen extends StatefulWidget {
  const AxleWeightAdvisorScreen({super.key});

  @override
  State<AxleWeightAdvisorScreen> createState() => _AxleWeightAdvisorScreenState();
}

class _AxleWeightAdvisorScreenState extends State<AxleWeightAdvisorScreen> {
  final AxleWeightAdvisorService _service = AxleWeightAdvisorService();
  ScaleWeightReceipt? _receipt;
  WeightAdjustmentAdvice? _advice;
  bool _isProcessing = false;

  void _scanScaleTicket() async {
    setState(() => _isProcessing = true);
    final receipt = await _service.processScaleTicketOCR();
    final advice = await _service.calculateAdjustment(receipt);
    
    if (mounted) {
      setState(() {
        _receipt = receipt;
        _advice = advice;
        _isProcessing = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Axle Weight Advisor'),
        backgroundColor: Colors.blueGrey[800],
      ),
      backgroundColor: Colors.grey[100],
      body: _isProcessing 
          ? _buildLoadingState() 
          : (_receipt == null ? _buildEmptyState() : _buildDashboard()),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.receipt_long, size: 80, color: Colors.blueGrey[200]),
          const SizedBox(height: 16),
          const Text('No scale ticket data.', style: TextStyle(color: Colors.grey, fontSize: 18)),
          const SizedBox(height: 24),
          ElevatedButton.icon(
            onPressed: _scanScaleTicket,
            icon: const Icon(Icons.camera_alt),
            label: const Text('SCAN CAT SCALE TICKET'),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.blueGrey[800], foregroundColor: Colors.white, padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12)),
          )
        ],
      ),
    );
  }

  Widget _buildLoadingState() {
    return const Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          CircularProgressIndicator(),
          SizedBox(height: 24),
          Text('Running OCR on scale ticket...'),
          Text('Calculating center of gravity...', style: TextStyle(color: Colors.grey)),
        ],
      ),
    );
  }

  Widget _buildDashboard() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          _buildCurrentWeights(),
          const SizedBox(height: 16),
          if (_advice != null && !_advice!.isCompliant) _buildAdjustmentAdvice(),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            height: 48,
            child: OutlinedButton.icon(
              onPressed: () {
                setState(() {
                  _receipt = null;
                  _advice = null;
                });
              },
              icon: const Icon(Icons.refresh),
              label: const Text('SCAN NEW TICKET'),
            ),
          )
        ],
      ),
    );
  }

  Widget _buildCurrentWeights() {
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('CURRENT WEIGHTS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
            const Divider(height: 24),
            _buildWeightRow('Steer Axles', _receipt!.steerAxleWeightLbs, 12000.0),
            _buildWeightRow('Drive Axles', _receipt!.driveAxleWeightLbs, 34000.0),
            _buildWeightRow('Trailer Axles', _receipt!.trailerAxleWeightLbs, 34000.0),
            const Divider(height: 24),
            _buildWeightRow('Gross Weight', _receipt!.grossWeightLbs, 80000.0, isGross: true),
          ],
        ),
      ),
    );
  }

  Widget _buildWeightRow(String label, double weight, double limit, {bool isGross = false}) {
    bool isOverweight = weight > limit;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(fontWeight: isGross ? FontWeight.bold : FontWeight.normal, fontSize: isGross ? 18 : 16)),
          Row(
            children: [
              Text('${weight.toInt()} lbs', style: TextStyle(color: isOverweight ? Colors.red : Colors.black, fontWeight: isOverweight ? FontWeight.bold : FontWeight.normal, fontSize: 16)),
              if (isOverweight) ...[
                const SizedBox(width: 8),
                const Icon(Icons.warning, color: Colors.red, size: 20),
              ]
            ],
          )
        ],
      ),
    );
  }

  Widget _buildAdjustmentAdvice() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(color: Colors.blue[50], borderRadius: BorderRadius.circular(16), border: Border.all(color: Colors.blue[300]!)),
      child: Column(
        children: [
          const Icon(Icons.settings_overscan, color: Colors.blue, size: 48),
          const SizedBox(height: 16),
          const Text('TANDEM SLIDE REQUIRED', style: TextStyle(color: Colors.blue, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
          const SizedBox(height: 8),
          Text(_advice!.instruction, textAlign: TextAlign.center, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          const Text('Estimated Result:', style: TextStyle(color: Colors.grey)),
          Text('Drive: ${_advice!.estimatedDriveWeightLbs.toInt()} lbs | Trailer: ${_advice!.estimatedTrailerWeightLbs.toInt()} lbs', style: const TextStyle(fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }
}
