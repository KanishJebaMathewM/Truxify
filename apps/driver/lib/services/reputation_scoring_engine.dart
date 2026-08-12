import 'dart:async';
import '../models/driver_reputation_model.dart';

class ReputationScoringEngine {
  /// Simulates fetching and calculating a driver's objective reputation
  /// score from a decentralized ledger or immutable database.
  Future<DriverReputation> fetchDriverReputation(String driverId) async {
    // Simulate database / ledger query delay
    await Future.delayed(const Duration(seconds: 1));

    // In a real system, these would be aggregated from IoT telemetry and load histories
    final onTimePercentage = 98.5;
    final claimsRatio = 0.2; // 0.2%
    final hardBrakingEvents = 3;

    // Calculate a composite reliability score (0-100)
    // Heuristic: On-time is heavily weighted, claims heavily penalize, braking slightly penalizes
    double score = onTimePercentage;
    score -= (claimsRatio * 10); // Heavy penalty for damage claims
    score -= (hardBrakingEvents * 0.5); // Minor penalty for unsafe driving

    if (score > 100) score = 100;
    if (score < 0) score = 0;

    String tier;
    if (score >= 95) {
      tier = 'PLATINUM';
    } else if (score >= 85) {
      tier = 'GOLD';
    } else if (score >= 70) {
      tier = 'SILVER';
    } else {
      tier = 'BRONZE';
    }

    return DriverReputation(
      driverId: driverId,
      overallScore: score,
      onTimePercentage: onTimePercentage,
      claimsRatio: claimsRatio,
      hardBrakingEvents: hardBrakingEvents,
      tier: tier,
    );
  }
}
