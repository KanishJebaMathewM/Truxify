import 'dart:async';
import '../models/weather_analytics_model.dart';

class WeatherAnalyticsService {
  final _sessionController = StreamController<WeatherAnalyticsSession>.broadcast();
  
  Stream<WeatherAnalyticsSession> get analyticsStream => _sessionController.stream;

  void initializeDashboard() {
    _emitState('Awaiting Route Data', '', '', DateTime.now(), [], 0.0, false);
  }

  void analyzeWinterRoute(String origin, String destination, DateTime departure) async {
    _emitState('Correlating Historical GPS Data...', origin, destination, departure, [], 0.0, true);

    await Future.delayed(const Duration(seconds: 1));
    
    _emitState('Analyzing NOAA Weather Patterns...', origin, destination, departure, [], 0.0, true);

    await Future.delayed(const Duration(seconds: 1));

    List<WeatherRiskProfile> risks = [
      WeatherRiskProfile(
        routeSegment: 'I-70 (Denver to Vail Pass)',
        historicalWeatherCondition: 'Heavy Snowfall / Blizzard',
        averageSummerSpeed: 65.0,
        historicalWinterSpeed: 35.0,
        speedReductionPercentage: 46.1,
        addedTransitTimeHours: 3.5,
        riskLevel: 'Severe',
      ),
      WeatherRiskProfile(
        routeSegment: 'I-80 (Wyoming Corridor)',
        historicalWeatherCondition: 'High Winds / Black Ice',
        averageSummerSpeed: 70.0,
        historicalWinterSpeed: 45.0,
        speedReductionPercentage: 35.7,
        addedTransitTimeHours: 2.0,
        riskLevel: 'High',
      )
    ];

    double totalAdded = risks.fold(0, (sum, item) => sum + item.addedTransitTimeHours);
    
    _emitState('Historical Risk Assessment Complete', origin, destination, departure, risks, totalAdded, false);
  }

  void _emitState(String status, String origin, String destination, DateTime departure, List<WeatherRiskProfile> risks, double totalAdded, bool isAnalyzing) {
    _sessionController.add(WeatherAnalyticsSession(
      status: status,
      origin: origin,
      destination: destination,
      targetDeparture: departure,
      segmentRisks: List.from(risks),
      totalAddedTransitHours: totalAdded,
      isAnalyzing: isAnalyzing,
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
