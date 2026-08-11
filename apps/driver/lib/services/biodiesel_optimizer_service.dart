import 'dart:async';
import '../models/biodiesel_optimizer_model.dart';

class BiodieselOptimizerService {
  final _analysisController = StreamController<FuelOptimizationAnalysis>.broadcast();

  Stream<FuelOptimizationAnalysis> get analysisStream => _analysisController.stream;

  void simulateFuelStopAnalysis() async {
    // 1. Analyzing context (Checking weather + engine load)
    _analysisController.add(FuelOptimizationAnalysis(
      locationName: 'Flying J - Denver, CO',
      routeMinTempF: 0.0, // Default pending
      averageEngineLoadPct: 0.0,
      availableBlends: [],
      estimatedSavings: 0.0,
    ));

    await Future.delayed(const Duration(seconds: 3));

    // 2. Result: B20 is rejected due to freezing temperatures over Vail Pass. B5 is recommended.
    _analysisController.add(FuelOptimizationAnalysis(
      locationName: 'Flying J - Denver, CO',
      routeMinTempF: 12.0, // Freezing temps ahead
      averageEngineLoadPct: 75.0, // Good engine temp, but weather is the limiting factor
      estimatedSavings: 18.50, // Savings vs ULSD
      availableBlends: [
        FuelBlendOption(
          blendName: 'B20 (20% Biodiesel)',
          pricePerGallon: 3.85,
          isRecommended: false,
          safetyStatus: 'Risk of Gelling',
          reason: 'Upcoming route drops to 12°F. B20 will gel and clog fuel lines.',
        ),
        FuelBlendOption(
          blendName: 'B5 (5% Biodiesel)',
          pricePerGallon: 3.99,
          isRecommended: true,
          safetyStatus: 'Safe',
          reason: 'Best balance of cost and cold-weather reliability.',
        ),
        FuelBlendOption(
          blendName: 'Standard ULSD',
          pricePerGallon: 4.15,
          isRecommended: false,
          safetyStatus: 'Safe',
          reason: 'Safe, but unnecessary premium cost.',
        ),
      ],
    ));
  }

  void dispose() {
    _analysisController.close();
  }
}
