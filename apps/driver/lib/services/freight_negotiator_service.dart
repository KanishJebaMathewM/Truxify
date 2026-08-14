import 'dart:async';
import '../models/freight_negotiator_model.dart';

class FreightNegotiatorService {
  final _sessionController = StreamController<NegotiationSession>.broadcast();

  Stream<NegotiationSession> get negotiationStream => _sessionController.stream;

  void initializeDashboard() {
    _emitState('Awaiting Load Selection', null, 0.0, '');
  }

  void analyzeLoadPricing() async {
    _emitState('Querying Historical API Data...', null, 0.0, '');

    await Future.delayed(const Duration(seconds: 1));
    
    _emitState('Generating AI Counter-Offer...', null, 0.0, '');

    await Future.delayed(const Duration(seconds: 1));

    MarketLaneData mockData = MarketLaneData(
      origin: 'Dallas, TX',
      destination: 'Chicago, IL',
      currentMarketAverageRate: 2.85,
      sevenDayHigh: 3.10,
      sevenDayLow: 2.45,
      brokerInitialOffer: 2.30, // Clear lowball
    );
    
    // AI determines the optimal counter offer is slightly above average
    double targetOffer = 2.95;
    
    String script = '''
Hi Broker Team,

I see you have the Dallas to Chicago flatbed posted for \$2.30/mi. 
Our market pricing API shows the current 7-day average for this lane is \$2.85/mi, with recent highs hitting \$3.10/mi due to capacity constraints.

I have a truck empty right now in Dallas. If you can meet me at \$2.95/mi, I can book this immediately and head to the shipper.

Thanks!
''';

    _emitState('Pricing Analysis Complete', mockData, targetOffer, script);
  }

  void _emitState(String status, MarketLaneData? data, double target, String script) {
    _sessionController.add(NegotiationSession(
      status: status,
      laneData: data,
      targetCounterOffer: target,
      generatedEmailScript: script,
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
