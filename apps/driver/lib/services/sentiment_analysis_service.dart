import 'dart:async';
import '../models/turnover_prediction_model.dart';

class SentimentAnalysisService {
  Future<List<DriverChurnRisk>> getAtRiskDrivers() async {
    // Simulate API call to ML backend parsing dispatch comms
    await Future.delayed(const Duration(seconds: 1));

    return [
      DriverChurnRisk(
        driverId: 'DRV-1029',
        driverName: 'Michael Torres',
        churnRiskScore: 88,
        riskCategory: 'Critical',
        contributingFactors: [
          'High negative sentiment in dispatch chat (Keywords: "waiting", "unpaid", "again")',
          '3 erratic schedule changes in last 14 days',
          'Missed home time request last weekend'
        ],
        recentSentimentTrend: -15.4,
        recommendedIntervention: 'Immediate phone call from Fleet Manager. Guarantee home time this weekend.',
      ),
      DriverChurnRisk(
        driverId: 'DRV-0842',
        driverName: 'Sarah Jenkins',
        churnRiskScore: 65,
        riskCategory: 'High',
        contributingFactors: [
          'Increased idle time at drop-offs',
          'Mentions of "breakdown" in comms'
        ],
        recentSentimentTrend: -8.2,
        recommendedIntervention: 'Schedule immediate maintenance for Truck 402. Offer \$100 inconvenience bonus.',
      ),
      DriverChurnRisk(
        driverId: 'DRV-1104',
        driverName: 'David Chen',
        churnRiskScore: 42,
        riskCategory: 'Medium',
        contributingFactors: [
          'Slight drop in average miles per week',
          'Neutral sentiment in recent comms'
        ],
        recentSentimentTrend: -2.1,
        recommendedIntervention: 'Assign high-mileage dedicated route next week.',
      )
    ];
  }
}
