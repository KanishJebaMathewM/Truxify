import 'dart:async';
import '../models/deadhead_heatmap_model.dart';

class DeadheadHeatmapService {
  final _sessionController = StreamController<DeadheadSession>.broadcast();
  
  final List<MarketRegion> _regions = [
    MarketRegion(regionName: 'Chicago Metro', stateCode: 'IL', loadToTruckRatio: 5.2, averageReloadRate: 2.85, emptyMileProbability: 0.05),
    MarketRegion(regionName: 'Dallas / Ft. Worth', stateCode: 'TX', loadToTruckRatio: 3.8, averageReloadRate: 2.15, emptyMileProbability: 0.15),
    MarketRegion(regionName: 'Billings', stateCode: 'MT', loadToTruckRatio: 0.4, averageReloadRate: 1.10, emptyMileProbability: 0.85),
    MarketRegion(regionName: 'Rapid City', stateCode: 'SD', loadToTruckRatio: 0.2, averageReloadRate: 0.95, emptyMileProbability: 0.92),
  ];

  Stream<DeadheadSession> get heatmapStream => _sessionController.stream;

  void initializeDashboard() {
    _emitState('Awaiting Load Selection', null);
  }

  void analyzeDestination(String destinationState) async {
    _emitState('Querying Historical Load Density...', null);

    await Future.delayed(const Duration(seconds: 1));
    
    _emitState('Rendering Spatial Heatmap...', null);

    await Future.delayed(const Duration(seconds: 1));

    MarketRegion? found = _regions.firstWhere(
      (r) => r.stateCode == destinationState, 
      orElse: () => _regions[0]
    );

    _emitState('Deadhead Probability Analyzed', found);
  }

  void _emitState(String status, MarketRegion? selected) {
    _sessionController.add(DeadheadSession(
      status: status,
      activeDestination: selected?.stateCode ?? 'NONE',
      heatmapData: List.from(_regions),
      selectedRegion: selected,
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
