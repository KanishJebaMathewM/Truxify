import 'dart:async';
import '../models/ai_broker_negotiation_model.dart';

class AIBrokerNegotiationService {
  final _sessionController = StreamController<NegotiationSession>.broadcast();

  Stream<NegotiationSession> get negotiationStream => _sessionController.stream;

  void startNegotiationBot() async {
    List<NegotiationMessage> history = [];
    
    // Initial State
    history.add(NegotiationMessage(
      sender: 'Broker',
      text: 'Posted Load: Chicago, IL -> Dallas, TX for \$1,800',
      offerAmountUsd: 1800,
      timestamp: DateTime.now().subtract(const Duration(minutes: 5)),
    ));
    
    _sessionController.add(NegotiationSession(
      loadId: 'LD-TXCH-09',
      brokerName: 'CH Robinson',
      origin: 'Chicago, IL',
      destination: 'Dallas, TX',
      initialBrokerOfferUsd: 1800,
      driverMinimumUsd: 2200,
      status: 'Negotiating',
      history: List.from(history),
    ));

    await Future.delayed(const Duration(seconds: 3));

    // AI Bot counters
    history.insert(0, NegotiationMessage(
      sender: 'AI Bot',
      text: 'Counter-offer: \$2,400. Market outbound volume in Chicago is up 15% today, and fuel averages \$4.10 along I-55.',
      offerAmountUsd: 2400,
      timestamp: DateTime.now(),
    ));
    _sessionController.add(NegotiationSession(loadId: 'LD-TXCH-09', brokerName: 'CH Robinson', origin: 'Chicago, IL', destination: 'Dallas, TX', initialBrokerOfferUsd: 1800, driverMinimumUsd: 2200, status: 'Negotiating', history: List.from(history)));

    await Future.delayed(const Duration(seconds: 4));

    // Broker counters back
    history.insert(0, NegotiationMessage(
      sender: 'Broker',
      text: 'I can do \$2,100 max. Take it or leave it.',
      offerAmountUsd: 2100,
      timestamp: DateTime.now(),
    ));
    _sessionController.add(NegotiationSession(loadId: 'LD-TXCH-09', brokerName: 'CH Robinson', origin: 'Chicago, IL', destination: 'Dallas, TX', initialBrokerOfferUsd: 1800, driverMinimumUsd: 2200, status: 'Negotiating', history: List.from(history)));

    await Future.delayed(const Duration(seconds: 4));

    // AI Bot final counter based on driver minimum
    history.insert(0, NegotiationMessage(
      sender: 'AI Bot',
      text: 'My firm minimum is \$2,200 for this lane. If you can meet \$2,200, we can book it immediately.',
      offerAmountUsd: 2200,
      timestamp: DateTime.now(),
    ));
    _sessionController.add(NegotiationSession(loadId: 'LD-TXCH-09', brokerName: 'CH Robinson', origin: 'Chicago, IL', destination: 'Dallas, TX', initialBrokerOfferUsd: 1800, driverMinimumUsd: 2200, status: 'Negotiating', history: List.from(history)));
    
    await Future.delayed(const Duration(seconds: 3));
    
    // Broker accepts
    history.insert(0, NegotiationMessage(
      sender: 'Broker',
      text: 'Alright, \$2,200. Sending the rate confirmation now.',
      offerAmountUsd: 2200,
      timestamp: DateTime.now(),
    ));
    _sessionController.add(NegotiationSession(loadId: 'LD-TXCH-09', brokerName: 'CH Robinson', origin: 'Chicago, IL', destination: 'Dallas, TX', initialBrokerOfferUsd: 1800, driverMinimumUsd: 2200, status: 'Accepted', history: List.from(history)));
  }
  
  void dispose() {
    _sessionController.close();
  }
}
