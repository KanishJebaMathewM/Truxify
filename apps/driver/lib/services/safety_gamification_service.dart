import 'dart:async';
import '../models/driver_safety_score_model.dart';

class SafetyGamificationService {
  Future<List<DriverSafetyScore>> getMonthlyLeaderboard() async {
    await Future.delayed(const Duration(seconds: 1));

    return [
      DriverSafetyScore(
        driverId: 'D-992',
        driverName: 'Sarah Jenkins',
        avatarUrl: 'SJ',
        totalScore: 985,
        rank: 1,
        harshBrakingEvents: 1,
        speedingEvents: 0,
        corneringEvents: 2,
        milesDriven: 4200.5,
      ),
      DriverSafetyScore(
        driverId: 'D-104',
        driverName: 'Marcus Cole',
        avatarUrl: 'MC',
        totalScore: 942,
        rank: 2,
        harshBrakingEvents: 3,
        speedingEvents: 1,
        corneringEvents: 4,
        milesDriven: 5100.0,
      ),
      DriverSafetyScore(
        driverId: 'D-883',
        driverName: 'Alex Rivero',
        avatarUrl: 'AR',
        totalScore: 915,
        rank: 3,
        harshBrakingEvents: 2,
        speedingEvents: 4,
        corneringEvents: 1,
        milesDriven: 3950.2,
        isCurrentUser: true,
      ),
      DriverSafetyScore(
        driverId: 'D-771',
        driverName: 'Tom Hanks',
        avatarUrl: 'TH',
        totalScore: 890,
        rank: 4,
        harshBrakingEvents: 6,
        speedingEvents: 2,
        corneringEvents: 5,
        milesDriven: 4800.0,
      ),
      DriverSafetyScore(
        driverId: 'D-442',
        driverName: 'Lisa Su',
        avatarUrl: 'LS',
        totalScore: 850,
        rank: 5,
        harshBrakingEvents: 8,
        speedingEvents: 5,
        corneringEvents: 8,
        milesDriven: 3100.0,
      ),
    ];
  }
}
