import 'dart:async';
import '../models/scale_bypass_model.dart';

class ScaleBypassService {
  final _sessionController = StreamController<BypassSession>.broadcast();

  Stream<BypassSession> get bypassStream => _sessionController.stream;

  void simulateScaleApproach() async {
    final station = WeighStationInfo(
      stationName: 'I-75 Northbound Marietta Weigh Station',
      highway: 'I-75 N',
      distanceMiles: 2.0,
    );

    // 1. Initial Approach (2 miles out)
    _sessionController.add(BypassSession(
      status: 'Scale House 2 Miles Ahead',
      station: station,
      currentGrossWeightLbs: 78500, // Legal (under 80k)
      safetyScoreIss: 24, // Good score
      isBypassGranted: null,
    ));

    await Future.delayed(const Duration(seconds: 3));

    // 2. Crossing Highway WIM Sensors (1 mile out)
    _sessionController.add(BypassSession(
      status: 'Crossing WIM Sensors. Transmitting e-Credentials...',
      station: station,
      currentGrossWeightLbs: 78500,
      safetyScoreIss: 24,
      isBypassGranted: null,
    ));
    
    await Future.delayed(const Duration(seconds: 3));

    // 3. Decision
    _sessionController.add(BypassSession(
      status: 'BYPASS GRANTED. DO NOT PULL IN.',
      station: station,
      currentGrossWeightLbs: 78500,
      safetyScoreIss: 24,
      isBypassGranted: true,
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
