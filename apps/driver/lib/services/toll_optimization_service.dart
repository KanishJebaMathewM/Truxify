import 'dart:async';
import '../models/toll_optimization_model.dart';
import '../models/toll_route_model.dart';

class TollOptimizationService {
  final _sessionController = StreamController<TollOptimizationSession>.broadcast();

  Stream<TollOptimizationSession> get optimizationStream => _sessionController.stream;

  /// Simulates optimizing toll vs fuel cost against the load payout.
  Future<List<TollRouteOption>> getOptimizedRoutes(double loadPayout) async {
    await Future.delayed(const Duration(seconds: 1));
    return [
      TollRouteOption(
        routeId: 'toll_fast',
        routeName: 'I-95 N (Toll)',
        description: 'Fastest route - toll roads',
        estimatedTimeMinutes: 120,
        estimatedTollCostUsd: 42.50,
        estimatedFuelCostUsd: 85.00,
        netProfitUsd: loadPayout - 127.50,
        isRecommended: true,
      ),
      TollRouteOption(
        routeId: 'free_slow',
        routeName: 'US-1 N (No Tolls)',
        description: 'Cheapest route - avoids tolls',
        estimatedTimeMinutes: 160,
        estimatedTollCostUsd: 0.0,
        estimatedFuelCostUsd: 95.00,
        netProfitUsd: loadPayout - 95.00,
        isRecommended: false,
      ),
    ];
  }

  void simulateOptimization() async {
    final origin = 'Philadelphia, PA';
    final destination = 'New York City, NY';
    final grossRevenue = 950.00; // Broker pay

    // 1. Calculating Tolls based on 5 axles
    _sessionController.add(TollOptimizationSession(
      origin: origin,
      destination: destination,
      grossRevenue: grossRevenue,
      status: 'Calculating 5-Axle Toll Costs...',
      alternativeRoutes: [],
    ));

    await Future.delayed(const Duration(seconds: 3));

    // 2. Analyzing fuel/time tradeoffs
    _sessionController.add(TollOptimizationSession(
      origin: origin,
      destination: destination,
      grossRevenue: grossRevenue,
      status: 'Analyzing Fuel vs. Time Tradeoffs...',
      alternativeRoutes: [],
    ));
    
    await Future.delayed(const Duration(seconds: 3));

    // 3. Complete
    _sessionController.add(TollOptimizationSession(
      origin: origin,
      destination: destination,
      grossRevenue: grossRevenue,
      status: 'Optimal Financial Route Identified',
      alternativeRoutes: [
        RouteFinancials(
          routeName: 'I-95 N (NJ Turnpike)',
          routeType: 'Fastest (Google Maps)',
          timeMinutes: 110,
          fuelCostDollars: 65.00,
          tollCostDollars: 145.50, // Massive 5-axle toll
          driverPayDollars: 55.00,
          totalTripCost: 265.50,
          netProfitMargin: 684.50,
          isRecommended: false,
        ),
        RouteFinancials(
          routeName: 'I-295 N & US-1',
          routeType: 'Most Profitable',
          timeMinutes: 145, // 35 mins slower
          fuelCostDollars: 72.00, // Slightly more fuel
          tollCostDollars: 12.00, // Avoiding huge tolls
          driverPayDollars: 72.50, // More hourly pay for driver
          totalTripCost: 156.50,
          netProfitMargin: 793.50, // Much higher profit
          isRecommended: true,
        ),
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
