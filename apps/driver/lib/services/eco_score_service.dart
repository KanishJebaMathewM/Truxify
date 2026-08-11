import 'dart:async';
import '../models/eco_score_model.dart';

class EcoScoreService {
  final _sessionController = StreamController<EcoScoreSession>.broadcast();

  Stream<EcoScoreSession> get scoreStream => _sessionController.stream;

  void simulateEcoTracking() async {
    // 1. Initial State
    _sessionController.add(EcoScoreSession(
      currentEcoScore: 942,
      estimatedFuelSavedGal: 42.5,
      financialBonusAccrued: 125.50,
      metrics: [
        EcoMetric(metricName: 'Smooth Acceleration', score: 95, status: 'Excellent'),
        EcoMetric(metricName: 'Hard Braking', score: 88, status: 'Good'),
        EcoMetric(metricName: 'Idle Time Reduction', score: 98, status: 'Excellent'),
      ],
      topDrivers: [
        LeaderboardRank(rank: 1, driverName: 'Marcus T.', totalScore: 985, isCurrentUser: false),
        LeaderboardRank(rank: 2, driverName: 'Sarah K.', totalScore: 960, isCurrentUser: false),
        LeaderboardRank(rank: 3, driverName: 'You', totalScore: 942, isCurrentUser: true),
        LeaderboardRank(rank: 4, driverName: 'David R.', totalScore: 910, isCurrentUser: false),
      ],
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Driver improves score through good shifting
    _sessionController.add(EcoScoreSession(
      currentEcoScore: 965, // Passed Sarah!
      estimatedFuelSavedGal: 45.0,
      financialBonusAccrued: 150.00, // Bonus goes up
      metrics: [
        EcoMetric(metricName: 'Smooth Acceleration', score: 97, status: 'Excellent'),
        EcoMetric(metricName: 'Hard Braking', score: 88, status: 'Good'),
        EcoMetric(metricName: 'Idle Time Reduction', score: 98, status: 'Excellent'),
      ],
      topDrivers: [
        LeaderboardRank(rank: 1, driverName: 'Marcus T.', totalScore: 985, isCurrentUser: false),
        LeaderboardRank(rank: 2, driverName: 'You', totalScore: 965, isCurrentUser: true), // Moved to #2
        LeaderboardRank(rank: 3, driverName: 'Sarah K.', totalScore: 960, isCurrentUser: false),
        LeaderboardRank(rank: 4, driverName: 'David R.', totalScore: 910, isCurrentUser: false),
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
