import 'dart:async';
import '../models/toll_route_model.dart';

class TollOptimizationService {
  /// Simulates calculating multiple routes and their associated toll vs. fuel costs
  Future<List<TollRouteOption>> getOptimizedRoutes(double loadPayout) async {
    await Future.delayed(const Duration(seconds: 2));

    return [
      TollRouteOption(
        routeId: 'RT-FAST',
        routeName: 'Fastest Route (High Toll)',
        description: 'I-95 Tollway Direct',
        estimatedTimeMinutes: 320,
        estimatedTollCostUsd: 185.50,
        estimatedFuelCostUsd: 210.00,
        netProfitUsd: loadPayout - 185.50 - 210.00,
        isRecommended: false,
      ),
      TollRouteOption(
        routeId: 'RT-OPT',
        routeName: 'Cost-Optimized Route',
        description: 'Avoids PA Turnpike, slightly longer',
        estimatedTimeMinutes: 365,
        estimatedTollCostUsd: 45.00,
        estimatedFuelCostUsd: 235.00,
        netProfitUsd: loadPayout - 45.00 - 235.00,
        isRecommended: true,
      ),
      TollRouteOption(
        routeId: 'RT-FREE',
        routeName: 'Toll-Free Route',
        description: 'US-30 Local Highways',
        estimatedTimeMinutes: 440,
        estimatedTollCostUsd: 0.00,
        estimatedFuelCostUsd: 285.00,
        netProfitUsd: loadPayout - 0.00 - 285.00,
        isRecommended: false,
      ),
    ];
  }
}
