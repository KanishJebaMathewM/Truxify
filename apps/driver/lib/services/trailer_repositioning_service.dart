import 'dart:async';
import '../models/trailer_repositioning_model.dart';

class TrailerRepositioningService {
  final _sessionController = StreamController<TrailerRepositioningSession>.broadcast();
  
  Stream<TrailerRepositioningSession> get optimizationStream => _sessionController.stream;

  void initializeDashboard() {
    _emitState('Awaiting Supply-Chain Optimization', [], [], false);
  }

  void runOptimizationAlgorithm() async {
    _emitState('Aggregating GPS Trailer Pools...', [], [], true);

    await Future.delayed(const Duration(seconds: 1));
    
    _emitState('Running Predictive Freight Demand Models...', [], [], true);

    await Future.delayed(const Duration(seconds: 1));

    List<ZoneDemand> analytics = [
      ZoneDemand(locationName: 'Atlanta, GA', emptyTrailersAvailable: 145, projectedFreightVolume: 20, status: 'Surplus'),
      ZoneDemand(locationName: 'Chicago, IL', emptyTrailersAvailable: 12, projectedFreightVolume: 110, status: 'Deficit'),
      ZoneDemand(locationName: 'Dallas, TX', emptyTrailersAvailable: 45, projectedFreightVolume: 40, status: 'Balanced'),
    ];

    List<RepositioningAction> actions = [
      RepositioningAction(
        originZone: 'Atlanta, GA',
        destinationZone: 'Chicago, IL',
        trailersToMove: 85,
        estimatedCost: 125000.00,
        projectedRevenueSaved: 420000.00,
      )
    ];
    
    _emitState('Optimization Algorithm Complete', analytics, actions, false);
  }

  void _emitState(String status, List<ZoneDemand> analytics, List<RepositioningAction> actions, bool isAnalyzing) {
    _sessionController.add(TrailerRepositioningSession(
      status: status,
      zoneAnalytics: List.from(analytics),
      suggestedActions: List.from(actions),
      isAnalyzing: isAnalyzing,
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
