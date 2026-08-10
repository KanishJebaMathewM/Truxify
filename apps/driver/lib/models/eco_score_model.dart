class EcoMetric {
  final String metricName; // "Hard Braking", "Excessive Idling", "Optimal RPM Shifting"
  final double score; // 0-100
  final String status; // "Excellent", "Needs Improvement"

  EcoMetric({
    required this.metricName,
    required this.score,
    required this.status,
  });
}

class LeaderboardRank {
  final int rank;
  final String driverName;
  final int totalScore;
  final bool isCurrentUser;

  LeaderboardRank({
    required this.rank,
    required this.driverName,
    required this.totalScore,
    required this.isCurrentUser,
  });
}

class EcoScoreSession {
  final int currentEcoScore; // Overall score (e.g., 942)
  final double estimatedFuelSavedGal;
  final double financialBonusAccrued;
  final List<EcoMetric> metrics;
  final List<LeaderboardRank> topDrivers;

  EcoScoreSession({
    required this.currentEcoScore,
    required this.estimatedFuelSavedGal,
    required this.financialBonusAccrued,
    required this.metrics,
    required this.topDrivers,
  });
}
