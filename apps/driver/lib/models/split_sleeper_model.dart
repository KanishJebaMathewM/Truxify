class HosTimelineEvent {
  final String status; // "Driving", "On Duty", "Sleeper Berth"
  final double durationHours;
  final bool isSplitQualifying;

  HosTimelineEvent({
    required this.status,
    required this.durationHours,
    required this.isSplitQualifying,
  });
}

class SplitSleeperSession {
  final String algorithmStatus;
  final double driveTimeRemaining;
  final double shiftTimeRemaining;
  final String recommendedSplitType; // "8/2 Split", "7/3 Split", "None"
  final String optimalAction; // "Take 2.0hr Off Duty Break Now"
  final List<HosTimelineEvent> currentShiftLog;

  SplitSleeperSession({
    required this.algorithmStatus,
    required this.driveTimeRemaining,
    required this.shiftTimeRemaining,
    required this.recommendedSplitType,
    required this.optimalAction,
    required this.currentShiftLog,
  });
}
