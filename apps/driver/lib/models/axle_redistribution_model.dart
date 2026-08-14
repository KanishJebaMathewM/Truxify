class AxleWeights {
  final double steerLbs; // Max 12k
  final double driveLbs; // Max 34k
  final double tandemLbs; // Max 34k
  
  double get total => steerLbs + driveLbs + tandemLbs;
  bool get isLegal => steerLbs <= 12000 && driveLbs <= 34000 && tandemLbs <= 34000 && total <= 80000;

  AxleWeights({
    required this.steerLbs,
    required this.driveLbs,
    required this.tandemLbs,
  });
}

class RedistributionSession {
  final String status; // "Overweight Detected", "Adjusting Pneumatics...", "Balanced"
  final bool isAdjusting;
  final AxleWeights currentWeights;
  final double targetPsiAdjustment;

  RedistributionSession({
    required this.status,
    required this.isAdjusting,
    required this.currentWeights,
    required this.targetPsiAdjustment,
  });
}
