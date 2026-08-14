import 'dart:async';
import '../models/freight_bot_model.dart';

class FreightBotService {
  final _sessionController = StreamController<FreightBotSession>.broadcast();

  Stream<FreightBotSession> get botStream => _sessionController.stream;

  void simulateNegotiation() async {
    final double minRate = 2.50; // $2.50/mile minimum

    // 1. Scanning
    _sessionController.add(FreightBotSession(
      status: 'Scanning DAT & Truckstop APIs...',
      driverMinimumRatePerMile: minRate,
      activeNegotiations: 0,
      rejectedOffers: 0,
      securedLoad: null,
      negotiationLog: [],
    ));

    await Future.delayed(const Duration(seconds: 3));

    // 2. Negotiating
    _sessionController.add(FreightBotSession(
      status: 'Actively Negotiating 3 Loads...',
      driverMinimumRatePerMile: minRate,
      activeNegotiations: 3,
      rejectedOffers: 4,
      securedLoad: null,
      negotiationLog: [
        LoadOffer(
          brokerName: 'CH Robinson',
          origin: 'Atlanta, GA',
          destination: 'Dallas, TX',
          distanceMiles: 780,
          offeredRate: 1800.0, // ~$2.30/mi
          targetRate: 2000.0, // Bot counter
          status: 'Countering (\$2.56/mi)',
        ),
        LoadOffer(
          brokerName: 'TQL',
          origin: 'Atlanta, GA',
          destination: 'Miami, FL',
          distanceMiles: 660,
          offeredRate: 1300.0, // < $2/mi
          targetRate: 1650.0,
          status: 'Rejected (Too low)',
        ),
      ],
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Load Secured
    final bookedLoad = LoadOffer(
      brokerName: 'Coyote Logistics',
      origin: 'Atlanta, GA',
      destination: 'Chicago, IL',
      distanceMiles: 715,
      offeredRate: 1950.0, // Final agreed rate
      targetRate: 1950.0,
      status: 'Booked (\$2.72/mi)',
    );

    _sessionController.add(FreightBotSession(
      status: 'LOAD SECURED & DISPATCHED',
      driverMinimumRatePerMile: minRate,
      activeNegotiations: 0,
      rejectedOffers: 12,
      securedLoad: bookedLoad,
      negotiationLog: [bookedLoad],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
