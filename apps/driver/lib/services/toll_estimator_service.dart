import 'dart:async';
import '../models/toll_estimator_model.dart';

class TollEstimatorService {
  final _sessionController = StreamController<TollEstimationSession>.broadcast();
  
  Stream<TollEstimationSession> get estimatorStream => _sessionController.stream;

  void initializeDashboard() {
    _emitState('Awaiting Route Input', '', '', [], 0.0, 0.0, false);
  }

  void calculateCrossBorderRoute(String origin, String destination) async {
    _emitState('Mapping International Toll Roads...', origin, destination, [], 0.0, 0.0, true);

    await Future.delayed(const Duration(seconds: 1));
    
    _emitState('Fetching Real-Time FOREX Rates...', origin, destination, [], 0.0, 0.0, true);

    await Future.delayed(const Duration(seconds: 1));

    // Mock Live Exchange Rates
    double cadToUsd = 0.73; // 1 CAD = 0.73 USD
    double mxnToUsd = 0.059; // 1 MXN = 0.059 USD

    List<TollPlaza> tolls = [];
    
    if (destination.contains('Toronto')) {
      tolls = [
        TollPlaza(name: 'Ohio Turnpike', country: 'USA', localCurrencyAmount: 12.50, localCurrencyCode: 'USD'),
        TollPlaza(name: 'Ambassador Bridge', country: 'Border', localCurrencyAmount: 36.00, localCurrencyCode: 'USD'),
        TollPlaza(name: 'Highway 407 ETR', country: 'Canada', localCurrencyAmount: 45.20, localCurrencyCode: 'CAD'), // Extremely expensive Canadian toll
      ];
    } else {
      tolls = [
        TollPlaza(name: 'Texas SH 130', country: 'USA', localCurrencyAmount: 22.15, localCurrencyCode: 'USD'),
        TollPlaza(name: 'World Trade Bridge', country: 'Border', localCurrencyAmount: 18.00, localCurrencyCode: 'USD'),
        TollPlaza(name: 'Monterrey Cuota', country: 'Mexico', localCurrencyAmount: 380.00, localCurrencyCode: 'MXN'),
      ];
    }

    _emitState('Cross-Border Analysis Complete', origin, destination, tolls, cadToUsd, mxnToUsd, false);
  }

  void _emitState(String status, String origin, String destination, List<TollPlaza> tolls, double cad, double mxn, bool isEstimating) {
    _sessionController.add(TollEstimationSession(
      status: status,
      origin: origin,
      destination: destination,
      routeTolls: List.from(tolls),
      exchangeRateCADtoUSD: cad,
      exchangeRateMXNtoUSD: mxn,
      isEstimating: isEstimating,
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
