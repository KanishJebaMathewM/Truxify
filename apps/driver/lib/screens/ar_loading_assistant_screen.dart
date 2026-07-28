import 'package:flutter/material.dart';
import '../models/ar_pallet_model.dart';
import '../services/ar_loading_engine.dart';

class ArLoadingAssistantScreen extends StatefulWidget {
  const ArLoadingAssistantScreen({super.key});

  @override
  State<ArLoadingAssistantScreen> createState() => _ArLoadingAssistantScreenState();
}

class _ArLoadingAssistantScreenState extends State<ArLoadingAssistantScreen> {
  final ArLoadingEngine _engine = ArLoadingEngine();
  List<ArPallet> _plan = [];
  bool _isInitializing = true;
  String _arStatusText = 'Scanning empty trailer geometry...';

  @override
  void initState() {
    super.initState();
    _initializeAR();
  }

  Future<void> _initializeAR() async {
    // Simulate LiDAR scan and calculation
    final plan = await _engine.calculateOptimalLoadingPlan('53-FOOT-DRY-VAN', []);
    if (mounted) {
      setState(() {
        _plan = plan;
        _isInitializing = false;
        _arStatusText = 'Point camera at the nose of the trailer';
      });
    }
  }

  Future<void> _confirmPalletPlacement(int index) async {
    final success = await _engine.verifyPlacementInAR(_plan[index].palletId);
    if (success && mounted) {
      setState(() {
        _plan[index] = ArPallet(
          palletId: _plan[index].palletId,
          weightLbs: _plan[index].weightLbs,
          dimensions: _plan[index].dimensions,
          optimalX: _plan[index].optimalX,
          optimalY: _plan[index].optimalY,
          optimalZ: _plan[index].optimalZ,
          isPlaced: true,
        );
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${_plan[index].palletId} verified in optimal position.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black, // Simulates background of a camera view
      appBar: AppBar(
        title: const Text('AR Loading Assistant'),
        backgroundColor: Colors.black.withOpacity(0.5),
        elevation: 0,
      ),
      extendBodyBehindAppBar: true,
      body: Stack(
        children: [
          // Simulated AR Camera Viewfinder
          Center(
            child: _isInitializing 
              ? const CircularProgressIndicator(color: Colors.cyanAccent)
              : Icon(Icons.view_in_ar, size: 120, color: Colors.cyan.withOpacity(0.3)),
          ),
          
          // AR Target Overlays (Mocked as UI elements for scaffolding)
          if (!_isInitializing)
            Positioned(
              top: MediaQuery.of(context).size.height * 0.4,
              left: MediaQuery.of(context).size.width * 0.2,
              child: _buildArBoundingBox(_plan.firstWhere((p) => !p.isPlaced, orElse: () => _plan[0])),
            ),

          // Heads Up Display (HUD)
          Positioned(
            bottom: 0,
            left: 0,
            right: 0,
            child: Container(
              padding: const EdgeInsets.all(24.0),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.bottomCenter,
                  end: Alignment.topCenter,
                  colors: [Colors.black.withOpacity(0.9), Colors.transparent],
                )
              ),
              child: Column(
                children: [
                  Text(_arStatusText, style: const TextStyle(color: Colors.cyanAccent, fontSize: 18, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 16),
                  if (!_isInitializing)
                    SizedBox(
                      height: 120,
                      child: ListView.builder(
                        scrollDirection: Axis.horizontal,
                        itemCount: _plan.length,
                        itemBuilder: (context, index) {
                          final pallet = _plan[index];
                          return GestureDetector(
                            onTap: () => _confirmPalletPlacement(index),
                            child: Container(
                              width: 100,
                              margin: const EdgeInsets.only(right: 12),
                              decoration: BoxDecoration(
                                color: pallet.isPlaced ? Colors.green.withOpacity(0.8) : Colors.grey[900],
                                border: Border.all(color: pallet.isPlaced ? Colors.greenAccent : Colors.cyanAccent),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(pallet.isPlaced ? Icons.check_circle : Icons.inventory_2, color: Colors.white),
                                  const SizedBox(height: 8),
                                  Text(pallet.palletId, style: const TextStyle(color: Colors.white, fontSize: 12)),
                                  Text('${pallet.weightLbs} lbs', style: const TextStyle(color: Colors.white70, fontSize: 10)),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                    )
                ],
              ),
            ),
          )
        ],
      ),
    );
  }

  Widget _buildArBoundingBox(ArPallet targetPallet) {
    if (targetPallet.isPlaced) return const SizedBox();
    
    return Container(
      width: 200,
      height: 150,
      decoration: BoxDecoration(
        border: Border.all(color: Colors.cyanAccent, width: 3),
        color: Colors.cyan.withOpacity(0.1),
      ),
      child: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.arrow_downward, color: Colors.cyanAccent, size: 40),
            Text('Place ${targetPallet.palletId} Here', style: const TextStyle(color: Colors.cyanAccent, fontWeight: FontWeight.bold)),
          ],
        ),
      ),
    );
  }
}
