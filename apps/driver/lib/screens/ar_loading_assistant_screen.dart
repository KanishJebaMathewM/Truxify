import 'package:flutter/material.dart';
import '../models/ar_cargo_model.dart';
import '../services/ar_loading_service.dart';

class ArLoadingAssistantScreen extends StatefulWidget {
  const ArLoadingAssistantScreen({super.key});

  @override
  State<ArLoadingAssistantScreen> createState() => _ArLoadingAssistantScreenState();
}

class _ArLoadingAssistantScreenState extends State<ArLoadingAssistantScreen> {
  final ArLoadingService _arService = ArLoadingService();
  List<ArPallet> _pallets = [];
  bool _isArActive = false;
  ArPallet? _focusedPallet;

  @override
  void initState() {
    super.initState();
    _loadPlan();
  }

  void _loadPlan() async {
    final pallets = await _arService.getLoadPlan();
    if (mounted) {
      setState(() {
        _pallets = pallets;
      });
    }
  }

  void _toggleArMode() {
    setState(() {
      _isArActive = !_isArActive;
      if (_isArActive && _pallets.isNotEmpty) {
        _focusedPallet = _pallets.firstWhere((p) => !p.isPlaced, orElse: () => _pallets.first);
      }
    });
  }

  void _markPlaced(ArPallet pallet) {
    setState(() {
      final index = _pallets.indexOf(pallet);
      _pallets[index] = ArPallet(
        palletId: pallet.palletId,
        destination: pallet.destination,
        weightLbs: pallet.weightLbs,
        isFragile: pallet.isFragile,
        suggestedPosition: pallet.suggestedPosition,
        colorCode: pallet.colorCode,
        isPlaced: true,
      );
      
      try {
        _focusedPallet = _pallets.firstWhere((p) => !p.isPlaced);
      } catch (e) {
        _focusedPallet = null; // All done
        _isArActive = false;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Loading Complete! Weight distribution optimized.'), backgroundColor: Colors.green)
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AR Cargo Loading Assistant'),
        backgroundColor: Colors.teal[900],
      ),
      body: _isArActive ? _buildArView() : _buildLoadPlanList(),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _toggleArMode,
        backgroundColor: _isArActive ? Colors.red : Colors.teal[900],
        icon: Icon(_isArActive ? Icons.close : Icons.view_in_ar),
        label: Text(_isArActive ? 'EXIT AR' : 'LAUNCH AR GUIDE'),
      ),
    );
  }

  Widget _buildLoadPlanList() {
    if (_pallets.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    return Column(
      children: [
        Container(
          padding: const EdgeInsets.all(16),
          color: Colors.teal[50],
          child: const Row(
            children: [
              Icon(Icons.info_outline, color: Colors.teal),
              SizedBox(width: 8),
              Expanded(child: Text('Launch AR Guide inside the trailer to project virtual placement boxes for LIFO and weight optimization.')),
            ],
          ),
        ),
        Expanded(
          child: ListView.builder(
            itemCount: _pallets.length,
            itemBuilder: (context, index) {
              final pallet = _pallets[index];
              return ListTile(
                leading: CircleAvatar(
                  backgroundColor: pallet.colorCode == 'BLUE' ? Colors.blue : Colors.orange,
                  child: Icon(pallet.isPlaced ? Icons.check : Icons.inventory_2, color: Colors.white),
                ),
                title: Text(pallet.palletId, style: TextStyle(decoration: pallet.isPlaced ? TextDecoration.lineThrough : null)),
                subtitle: Text('${pallet.destination} • ${pallet.weightLbs} lbs\nTarget: ${pallet.suggestedPosition}'),
                trailing: pallet.isFragile ? const Icon(Icons.wine_bar, color: Colors.red) : null,
                isThreeLine: true,
              );
            },
          ),
        ),
      ],
    );
  }

  Widget _buildArView() {
    return Stack(
      children: [
        // Simulated Camera Feed
        Container(
          width: double.infinity,
          height: double.infinity,
          color: Colors.black,
          child: const Opacity(
            opacity: 0.3,
            child: Icon(Icons.camera, size: 200, color: Colors.white),
          ),
        ),
        
        // AR Overlay Elements
        if (_focusedPallet != null) ...[
          // Simulated AR Projected Box
          Center(
            child: Container(
              width: 250,
              height: 250,
              decoration: BoxDecoration(
                border: Border.all(
                  color: _focusedPallet!.colorCode == 'BLUE' ? Colors.blueAccent : Colors.orangeAccent,
                  width: 4,
                  style: BorderStyle.solid, // Dash usually requires custom painter, solid is fine for mock
                ),
                color: (_focusedPallet!.colorCode == 'BLUE' ? Colors.blueAccent : Colors.orangeAccent).withOpacity(0.2),
              ),
              child: const Center(
                child: Text('PLACE HERE', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 24)),
              ),
            ),
          ),
          
          // HUD Info Panel
          Positioned(
            top: 24,
            left: 16,
            right: 16,
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: Colors.black87, borderRadius: BorderRadius.circular(12)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('NEXT PALLET', style: TextStyle(color: Colors.grey, fontSize: 12)),
                  Text('${_focusedPallet!.palletId} - ${_focusedPallet!.weightLbs} lbs', style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  Text('Destination: ${_focusedPallet!.destination}', style: const TextStyle(color: Colors.white70)),
                  Text('Target: ${_focusedPallet!.suggestedPosition}', style: const TextStyle(color: Colors.tealAccent, fontWeight: FontWeight.bold)),
                ],
              ),
            ),
          ),
          
          // Placement Confirmation
          Positioned(
            bottom: 100,
            left: 50,
            right: 50,
            child: ElevatedButton.icon(
              onPressed: () => _markPlaced(_focusedPallet!),
              icon: const Icon(Icons.check_circle),
              label: const Text('CONFIRM PLACEMENT'),
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.teal,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 16),
              ),
            ),
          )
        ]
      ],
    );
  }
}
