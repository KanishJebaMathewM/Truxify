import 'dart:async';
import '../models/broker_trust_model.dart';

class BrokerTrustService {
  final _sessionController = StreamController<BrokerTrustSession>.broadcast();

  Stream<BrokerTrustSession> get trustStream => _sessionController.stream;

  void analyzeBrokers() async {
    _sessionController.add(BrokerTrustSession(
      status: 'Aggregating Broker History Data...',
      analyzedBrokers: [],
    ));

    await Future.delayed(const Duration(seconds: 2));

    _sessionController.add(BrokerTrustSession(
      status: 'Marketplace Trust Scores Generated',
      analyzedBrokers: [
        BrokerProfile(
          brokerId: 'B-1102',
          companyName: 'Apex Freight Logistics',
          mcNumber: 'MC-884210',
          trustScore: 94,
          averageDaysToPay: 14.5,
          cancellationRatePercent: 2.1,
          totalLoadsBrokered: 15420,
          riskCategory: 'Low Risk',
        ),
        BrokerProfile(
          brokerId: 'B-3491',
          companyName: 'Midwest Transit Solutions',
          mcNumber: 'MC-441092',
          trustScore: 72,
          averageDaysToPay: 35.0,
          cancellationRatePercent: 8.5,
          totalLoadsBrokered: 3100,
          riskCategory: 'Moderate Risk',
        ),
        BrokerProfile(
          brokerId: 'B-9921',
          companyName: 'FastTrack Shipping LLC',
          mcNumber: 'MC-991204',
          trustScore: 38,
          averageDaysToPay: 82.4, // Takes forever to pay
          cancellationRatePercent: 18.2, // Cancels frequently
          totalLoadsBrokered: 450,
          riskCategory: 'High Risk',
        ),
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
