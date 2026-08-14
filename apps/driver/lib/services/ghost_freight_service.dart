import 'dart:async';
import '../models/ghost_freight_model.dart';

class GhostFreightService {
  final _sessionController = StreamController<GhostFreightSession>.broadcast();
  
  Stream<GhostFreightSession> get scanningStream => _sessionController.stream;

  void initializeScanner() {
    _emitState('Awaiting Load Board Refresh', [], false);
  }

  void scanLoadBoardData() async {
    _emitState('Connecting to Broker APIs...', [], true);

    await Future.delayed(const Duration(seconds: 1));
    
    _emitState('Running Heuristic Pattern Detection...', [], true);

    await Future.delayed(const Duration(seconds: 1));

    List<LoadPosting> loads = [
      LoadPosting(
        loadId: 'LD-991A',
        origin: 'Atlanta, GA',
        destination: 'Miami, FL',
        rate: 2800.00,
        brokerName: 'Apex Logistics LLC',
        refreshCount: 2,
        minutesActive: 14,
        brokerBaitSwitchRate: 0.05,
        ghostProbabilityScore: 2.1,
        statusFlag: 'Verified Real',
      ),
      LoadPosting(
        loadId: 'LD-332X',
        origin: 'Chicago, IL',
        destination: 'Dallas, TX',
        rate: 4500.00, // Suspiciously high
        brokerName: 'Unknown Brokerage Inc',
        refreshCount: 68, // Massive refresh count
        minutesActive: 240, // 4 hours old
        brokerBaitSwitchRate: 0.88,
        ghostProbabilityScore: 97.5,
        statusFlag: 'High Risk Ghost',
      ),
      LoadPosting(
        loadId: 'LD-774B',
        origin: 'Seattle, WA',
        destination: 'Portland, OR',
        rate: 900.00,
        brokerName: 'Cascade Freight',
        refreshCount: 15,
        minutesActive: 95,
        brokerBaitSwitchRate: 0.45,
        ghostProbabilityScore: 55.0,
        statusFlag: 'Suspicious',
      )
    ];

    _emitState('Heuristic Analysis Complete', loads, false);
  }

  void _emitState(String status, List<LoadPosting> loads, bool isScanning) {
    _sessionController.add(GhostFreightSession(
      status: status,
      analyzedLoads: List.from(loads),
      isScanning: isScanning,
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
