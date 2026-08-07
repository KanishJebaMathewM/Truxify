import 'dart:async';
import '../models/broker_score_model.dart';

class BrokerReliabilityService {
  Future<BrokerReliabilityScore> getBrokerScore(String brokerId) async {
    // Simulate API call to fetch aggregated broker data
    await Future.delayed(const Duration(seconds: 1));

    if (brokerId == 'BRK-9901') {
      return BrokerReliabilityScore(
        brokerId: 'BRK-9901',
        brokerName: 'Apex Logistics LLC',
        overallScore: 92,
        averageDaysToPay: 14.5,
        loadCancellationRate: 1.2,
        driverRating: 4.8,
        isFactoringApproved: true,
        recentReviews: [
          '"Paid fast, clear instructions on the pickup."',
          '"Good broker, dispatch was easy to reach."'
        ],
      );
    } else {
       return BrokerReliabilityScore(
        brokerId: brokerId,
        brokerName: 'Shadow Freight Brokers',
        overallScore: 45,
        averageDaysToPay: 65.2, // Terrible pay speed
        loadCancellationRate: 18.5, // High cancellation
        driverRating: 2.1,
        isFactoringApproved: false, // High risk
        recentReviews: [
          '"Canceled load while I was driving to the shipper. Avoid."',
          '"Took 70 days to pay the invoice. Had to threaten collections."'
        ],
      );
    }
  }
}
