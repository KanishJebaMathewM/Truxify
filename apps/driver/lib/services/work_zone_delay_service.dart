import 'dart:async';
import '../models/work_zone_delay_model.dart';

class WorkZoneDelayService {
  final _analysisController = StreamController<WorkZoneRouteAnalysis>.broadcast();

  Stream<WorkZoneRouteAnalysis> get analysisStream => _analysisController.stream;

  void simulateDelayPrediction() async {
    // 1. Initial Processing
    _analysisController.add(WorkZoneRouteAnalysis(
      routeId: 'Dallas to Chicago (I-44 Corridor)',
      totalPredictedDelayMinutes: 0,
      activeZones: [],
      rerouteRecommended: false,
      rerouteTimeSavingsMinutes: 0,
    ));

    await Future.delayed(const Duration(seconds: 3));

    // 2. Fetching DOT Data - Found minor delays
    _analysisController.add(WorkZoneRouteAnalysis(
      routeId: 'Dallas to Chicago (I-44 Corridor)',
      totalPredictedDelayMinutes: 15,
      activeZones: [
        WorkZoneEvent(
          highwaySegment: 'I-44 North (MM 120-125)',
          constructionType: 'Shoulder Repair',
          predictedDelayMinutes: 15,
          impactSeverity: 'Low',
          scheduledStart: DateTime.now().subtract(const Duration(days: 1)),
          scheduledEnd: DateTime.now().add(const Duration(days: 30)),
        )
      ],
      rerouteRecommended: false,
      rerouteTimeSavingsMinutes: 0,
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 3. Massive Delay Detected - Reroute triggered
    _analysisController.add(WorkZoneRouteAnalysis(
      routeId: 'Dallas to Chicago (I-44 Corridor)',
      totalPredictedDelayMinutes: 135, // 2+ hours!
      activeZones: [
        WorkZoneEvent(
          highwaySegment: 'I-55 North (Bridge Expansion)',
          constructionType: 'Full Lane Closure - Single Lane Traffic',
          predictedDelayMinutes: 120,
          impactSeverity: 'Severe',
          scheduledStart: DateTime.now(),
          scheduledEnd: DateTime.now().add(const Duration(days: 5)),
        ),
        WorkZoneEvent(
          highwaySegment: 'I-44 North (MM 120-125)',
          constructionType: 'Shoulder Repair',
          predictedDelayMinutes: 15,
          impactSeverity: 'Low',
          scheduledStart: DateTime.now().subtract(const Duration(days: 1)),
          scheduledEnd: DateTime.now().add(const Duration(days: 30)),
        )
      ],
      rerouteRecommended: true,
      rerouteTimeSavingsMinutes: 90, // Detour adds 30 mins, but saves 120 mins
    ));
  }

  void dispose() {
    _analysisController.close();
  }
}
