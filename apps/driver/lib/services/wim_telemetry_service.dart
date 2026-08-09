import 'dart:async';
import '../models/wim_telemetry_model.dart';

class WimTelemetryService {
  final _syncController = StreamController<WimSyncEvent>.broadcast();

  Stream<WimSyncEvent> get syncStream => _syncController.stream;

  void simulateWimCrossing() async {
    // 1. Approaching weigh station
    _syncController.add(WimSyncEvent(
      weighStationName: 'I-80 EB Iowa Scale',
      distanceToStationMiles: 2.5,
      status: 'Approaching WIM Sensors',
      dotResponse: 'Awaiting sensor crossing...',
      axleReadings: [],
    ));

    await Future.delayed(const Duration(seconds: 3));

    // 2. Crossing WIM - Highway sensor detects a bounce/false positive on Drive axles
    _syncController.add(WimSyncEvent(
      weighStationName: 'I-80 EB Iowa Scale',
      distanceToStationMiles: 1.0,
      status: 'WIM Dispute Detected',
      dotResponse: 'Highway WIM indicates overweight. Transmitting onboard telemetry for override...',
      axleReadings: [
        AxleWeightReading(axleGroup: 'Steer', dotLimitLbs: 12000, highwayWimReadingLbs: 11500, onboardTelemetryLbs: 11450, isWimFalsePositive: false),
        AxleWeightReading(axleGroup: 'Drive', dotLimitLbs: 34000, highwayWimReadingLbs: 35200, onboardTelemetryLbs: 33800, isWimFalsePositive: true), // The false positive!
        AxleWeightReading(axleGroup: 'Trailer', dotLimitLbs: 34000, highwayWimReadingLbs: 32000, onboardTelemetryLbs: 32100, isWimFalsePositive: false),
      ],
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 3. DOT accepts onboard telemetry and grants bypass
    _syncController.add(WimSyncEvent(
      weighStationName: 'I-80 EB Iowa Scale',
      distanceToStationMiles: 0.2,
      status: 'Bypass Granted',
      dotResponse: 'Override accepted by DOT enforcement. Onboard telemetry verified. BYPASS SCALE.',
      axleReadings: [
        AxleWeightReading(axleGroup: 'Steer', dotLimitLbs: 12000, highwayWimReadingLbs: 11500, onboardTelemetryLbs: 11450, isWimFalsePositive: false),
        AxleWeightReading(axleGroup: 'Drive', dotLimitLbs: 34000, highwayWimReadingLbs: 35200, onboardTelemetryLbs: 33800, isWimFalsePositive: true),
        AxleWeightReading(axleGroup: 'Trailer', dotLimitLbs: 34000, highwayWimReadingLbs: 32000, onboardTelemetryLbs: 32100, isWimFalsePositive: false),
      ],
    ));
  }

  void dispose() {
    _syncController.close();
  }
}
