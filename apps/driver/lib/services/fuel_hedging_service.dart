import 'dart:async';
import '../models/fuel_hedging_model.dart';

class FuelHedgingService {
  final _sessionController = StreamController<FuelHedgingSession>.broadcast();

  Stream<FuelHedgingSession> get hedgingStream => _sessionController.stream;

  void simulateFuelOptimization() async {
    // 1. Calculating
    _sessionController.add(FuelHedgingSession(
      status: 'Analyzing I-10 Fuel Price Arbitrage...',
      currentFuelLevelGallons: 45.0,
      tankCapacityGallons: 200.0,
      averageMpg: 6.8,
      totalTripSavingsUsd: 0.0,
      plannedStops: [],
    ));

    await Future.delayed(const Duration(seconds: 3));

    // 2. Plan Generated
    _sessionController.add(FuelHedgingSession(
      status: 'OPTIMIZED FUEL PLAN ACTIVE',
      currentFuelLevelGallons: 45.0,
      tankCapacityGallons: 200.0,
      averageMpg: 6.8,
      totalTripSavingsUsd: 142.50, // Saved $142 by hedging
      plannedStops: [
        FuelStop(
          stationName: 'Love\'s Travel Stop #182',
          location: 'Blythe, CA',
          distanceAwayMiles: 12.0,
          pricePerGallon: 5.45,
          suggestedGallons: 30.0, // Just enough to get out of CA
          isOptimal: false, // Expensive state
        ),
        FuelStop(
          stationName: 'Pilot Travel Center #341',
          location: 'Ehrenberg, AZ',
          distanceAwayMiles: 48.0,
          pricePerGallon: 4.15,
          suggestedGallons: 155.0, // Fill the rest here, AZ is cheap
          isOptimal: true, // Cheap state
        ),
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
