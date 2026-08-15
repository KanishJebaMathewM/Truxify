class DriverEcoScore {
  final int rank;
  final String driverName;
  final String avatarUrl;
  final int score;
  final String trend; // "Up", "Down", "Same"
  final List<String> badges; // "Smooth Braker", "Coasting King"

  DriverEcoScore({
    required this.rank,
    required this.driverName,
    required this.avatarUrl,
    required this.score,
    required this.trend,
    required this.badges,
  });
}

class EcoLeaderboardSession {
  final String status;
  final int currentDriverRank;
  final int currentDriverScore;
  final double fuelSavedGallons;
  final List<DriverEcoScore> leaderboard;

  EcoLeaderboardSession({
    required this.status,
    required this.currentDriverRank,
    required this.currentDriverScore,
    required this.fuelSavedGallons,
    required this.leaderboard,
  });
}
