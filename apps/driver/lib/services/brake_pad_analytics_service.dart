import 'dart:async';
import '../models/brake_pad_analytics_model.dart';

class BrakePadAnalyticsService {
  /// Simulates analyzing telematics data (braking frequency, load weight, elevation changes)
  Future<List<BrakePadAnalytics>> getBrakePadWearAnalytics() async {
    await Future.delayed(const Duration(seconds: 2));

    return [
      BrakePadAnalytics(
        axlePosition: 'Steer Axle',
        estimatedRemainingLifePercent: 82.5,
        estimatedRemainingMiles: 45000,
        wearSeverity: 'Low',
        contributingFactors: ['Normal city driving'],
      ),
      BrakePadAnalytics(
        axlePosition: 'Drive Axle 1',
        estimatedRemainingLifePercent: 45.0,
        estimatedRemainingMiles: 15000,
        wearSeverity: 'Moderate',
        contributingFactors: ['Heavy load weights', 'Frequent mountain descents'],
      ),
      BrakePadAnalytics(
        axlePosition: 'Trailer Axle 2',
        estimatedRemainingLifePercent: 8.2,
        estimatedRemainingMiles: 1200,
        wearSeverity: 'Critical',
        contributingFactors: ['Uneven brake bias', 'Aggressive braking events detected'],
      ),
    ];
  }
}
