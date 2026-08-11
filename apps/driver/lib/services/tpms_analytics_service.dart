import 'dart:async';
import '../models/tire_analytics_model.dart';

class TpmsAnalyticsService {
  /// Simulates ingesting live TPMS data and running a predictive model against it
  Future<List<TireAnalytics>> getLiveTireHealth() async {
    await Future.delayed(const Duration(seconds: 2));

    return [
      TireAnalytics(
        tirePosition: 'Front Left (Steer)',
        currentPressurePsi: 105,
        currentTempF: 110,
        estimatedTreadDepthMm: 12.5,
        blowoutRiskPercentage: 2.1,
        recommendation: 'Optimal condition.',
        isCritical: false,
      ),
      TireAnalytics(
        tirePosition: 'Front Right (Steer)',
        currentPressurePsi: 104,
        currentTempF: 112,
        estimatedTreadDepthMm: 11.8,
        blowoutRiskPercentage: 3.5,
        recommendation: 'Optimal condition.',
        isCritical: false,
      ),
      TireAnalytics(
        tirePosition: 'Drive Axle 2 - Outer Right',
        currentPressurePsi: 88, // Under-inflated
        currentTempF: 145, // Overheating
        estimatedTreadDepthMm: 3.2, // Dangerously low tread
        blowoutRiskPercentage: 87.5,
        recommendation: 'CRITICAL: Immediate replacement required at next exit. High blowout risk.',
        isCritical: true,
      ),
    ];
  }
}
