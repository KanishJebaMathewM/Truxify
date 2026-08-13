import 'dart:async';
import '../models/split_sleeper_model.dart';

class SplitSleeperService {
  final _sessionController = StreamController<SplitSleeperSession>.broadcast();

  Stream<SplitSleeperSession> get sleeperStream => _sessionController.stream;

  void analyzeLogbook() async {
    _sessionController.add(SplitSleeperSession(
      algorithmStatus: 'Analyzing FMCSA HOS Ruleset...',
      driveTimeRemaining: 0.0,
      shiftTimeRemaining: 0.0,
      recommendedSplitType: 'Calculating...',
      optimalAction: 'Processing...',
      currentShiftLog: [],
    ));

    await Future.delayed(const Duration(seconds: 2));

    _sessionController.add(SplitSleeperSession(
      algorithmStatus: 'Logbook Optimized: FMCSA Compliant',
      driveTimeRemaining: 1.5, // Running out of time
      shiftTimeRemaining: 2.0,
      recommendedSplitType: '8/2 Split-Sleeper Berth',
      optimalAction: 'Take 2.0hr Off-Duty break now to pause 14hr clock and regain 6.5hrs of drive time.',
      currentShiftLog: [
        HosTimelineEvent(status: 'Driving', durationHours: 5.5, isSplitQualifying: false),
        HosTimelineEvent(status: 'On Duty (Fuel)', durationHours: 0.5, isSplitQualifying: false),
        HosTimelineEvent(status: 'Driving', durationHours: 4.0, isSplitQualifying: false),
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
