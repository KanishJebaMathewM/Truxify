import 'dart:async';
import '../models/eco_leaderboard_model.dart';

class EcoLeaderboardService {
  final _sessionController = StreamController<EcoLeaderboardSession>.broadcast();

  Stream<EcoLeaderboardSession> get leaderboardStream => _sessionController.stream;

  void fetchLeaderboard() async {
    _sessionController.add(EcoLeaderboardSession(
      status: 'Analyzing Telemetry Data...',
      currentDriverRank: 0,
      currentDriverScore: 0,
      fuelSavedGallons: 0.0,
      leaderboard: [],
    ));

    await Future.delayed(const Duration(seconds: 2));

    _sessionController.add(EcoLeaderboardSession(
      status: 'Leaderboard Updated',
      currentDriverRank: 2,
      currentDriverScore: 890,
      fuelSavedGallons: 42.5,
      leaderboard: [
        DriverEcoScore(rank: 1, driverName: 'Sarah Jenkins', avatarUrl: 'assets/avatars/1.png', score: 950, trend: 'Same', badges: ['Coasting King', 'Feather Foot']),
        DriverEcoScore(rank: 2, driverName: 'You (Mohith)', avatarUrl: 'assets/avatars/2.png', score: 890, trend: 'Up', badges: ['Smooth Braker']),
        DriverEcoScore(rank: 3, driverName: 'Marcus Cole', avatarUrl: 'assets/avatars/3.png', score: 820, trend: 'Down', badges: ['Idle Saver']),
        DriverEcoScore(rank: 4, driverName: 'David Chen', avatarUrl: 'assets/avatars/4.png', score: 710, trend: 'Down', badges: []),
        DriverEcoScore(rank: 5, driverName: 'Amanda Ross', avatarUrl: 'assets/avatars/5.png', score: 650, trend: 'Up', badges: ['Improving']),
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
