import 'dart:async';
import '../models/broker_credit_scoring_model.dart';

class BrokerCreditScoringService {
  Future<List<BrokerCreditProfile>> getBrokerProfiles() async {
    await Future.delayed(const Duration(seconds: 1));
    return [
      BrokerCreditProfile(
        brokerId: 'BRK-1001',
        brokerName: 'TQL (Total Quality Logistics)',
        mcNumber: 'MC-019283',
        totalReports: 1450,
        averageDaysToPay: 21.5,
        defaultReports: 0,
        trustScore: 'A+',
        isWarningActive: false,
      ),
      BrokerCreditProfile(
        brokerId: 'BRK-1002',
        brokerName: 'Coyote Logistics',
        mcNumber: 'MC-048123',
        totalReports: 890,
        averageDaysToPay: 28.0,
        defaultReports: 2,
        trustScore: 'B',
        isWarningActive: false,
      ),
      BrokerCreditProfile(
        brokerId: 'BRK-1003',
        brokerName: 'FlyByNight Freight LLC', // Bad actor
        mcNumber: 'MC-099912',
        totalReports: 45,
        averageDaysToPay: 85.0, // Taking almost 3 months
        defaultReports: 12,
        trustScore: 'F',
        isWarningActive: true,
      ),
    ];
  }

  Future<bool> reportPayment(String brokerId, int daysToPay, bool didDefault) async {
    await Future.delayed(const Duration(seconds: 2));
    return true;
  }
}
