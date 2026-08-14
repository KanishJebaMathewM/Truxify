import 'package:flutter/material.dart';
import '../models/accessorial_charge_model.dart';
import '../services/charge_resolution_service.dart';

class ChargeDisputeScreen extends StatefulWidget {
  const ChargeDisputeScreen({super.key});

  @override
  State<ChargeDisputeScreen> createState() => _ChargeDisputeScreenState();
}

class _ChargeDisputeScreenState extends State<ChargeDisputeScreen> {
  final ChargeResolutionService _resolutionService = ChargeResolutionService();
  List<AccessorialCharge> _charges = [];
  bool _isLoading = true;
  final Set<String> _processingIds = {};

  @override
  void initState() {
    super.initState();
    _loadCharges();
  }

  void _loadCharges() async {
    final data = await _resolutionService.getPendingCharges();
    if (mounted) {
      setState(() {
        _charges = data;
        _isLoading = false;
      });
    }
  }

  void _processCharge(AccessorialCharge charge, int index) async {
    setState(() => _processingIds.add(charge.chargeId));
    
    final resolvedCharge = await _resolutionService.processChargeWithAI(charge);
    
    if (mounted) {
      setState(() {
        _charges[index] = resolvedCharge;
        _processingIds.remove(charge.chargeId);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AI Accessorial Resolution'),
        backgroundColor: Colors.blueGrey[800],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: _charges.length,
              itemBuilder: (context, index) {
                return _buildChargeCard(_charges[index], index);
              },
            ),
    );
  }

  Widget _buildChargeCard(AccessorialCharge charge, int index) {
    final isProcessing = _processingIds.contains(charge.chargeId);
    final isApproved = charge.aiStatus == 'Approved by AI';

    Color headerColor = Colors.grey[700]!;
    if (isApproved) headerColor = Colors.green[700]!;
    if (charge.aiStatus == 'Requires Manual Audit') headerColor = Colors.orange[700]!;

    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: headerColor,
              borderRadius: const BorderRadius.only(topLeft: Radius.circular(12), topRight: Radius.circular(12)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('${charge.chargeType} - ${charge.loadId}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
                Text('\$${charge.amount.toStringAsFixed(2)}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(
                      isApproved ? Icons.check_circle : (isProcessing ? Icons.memory : Icons.hourglass_empty), 
                      color: isApproved ? Colors.green : Colors.blueGrey,
                    ),
                    const SizedBox(width: 8),
                    Text(isProcessing ? 'AI Agent Analyzing...' : charge.aiStatus, style: const TextStyle(fontWeight: FontWeight.bold)),
                  ],
                ),
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: Colors.grey[100], borderRadius: BorderRadius.circular(8)),
                  child: Text(charge.confidenceReason, style: TextStyle(color: Colors.grey[800], fontSize: 13)),
                ),
                const SizedBox(height: 16),
                if (!isApproved && !isProcessing)
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      onPressed: () => _processCharge(charge, index),
                      icon: const Icon(Icons.smart_toy),
                      label: const Text('RUN AI RESOLUTION'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.blueGrey[800],
                        foregroundColor: Colors.white,
                      ),
                    ),
                  ),
                if (isProcessing)
                  const Center(child: Padding(padding: EdgeInsets.all(8.0), child: LinearProgressIndicator()))
              ],
            ),
          )
        ],
      ),
    );
  }
}
