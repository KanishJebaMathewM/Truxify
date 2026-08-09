import 'dart:async';
import '../models/dynamic_toll_model.dart';

class DynamicTollService {
  Future<List<DynamicTollRoute>> analyzeRoutes(double grossRevenue) async {
    await Future.delayed(const Duration(seconds: 2));

    return [
      DynamicTollRoute(
        routeName: 'I-95 Express (Fastest)',
        timeHours: 6.5,
        distanceMiles: 400,
        class8TollCostUsd: 215.00,
        fuelCostUsd: 280.00,
        netProfitUsd: grossRevenue - 215.00 - 280.00,
        isHighestProfit: false,
      ),
      DynamicTollRoute(
        routeName: 'US-301 Alternative (Highest Profit)',
        timeHours: 7.2,
        distanceMiles: 415,
        class8TollCostUsd: 15.00, // Massively reduced tolls
        fuelCostUsd: 290.00,
        netProfitUsd: grossRevenue - 15.00 - 290.00,
        isHighestProfit: true,
      ),
      DynamicTollRoute(
        routeName: 'I-81 Local (Zero Tolls)',
        timeHours: 8.5,
        distanceMiles: 450,
        class8TollCostUsd: 0.00,
        fuelCostUsd: 315.00,
        netProfitUsd: grossRevenue - 0.00 - 315.00,
        isHighestProfit: false,
      ),
    ];
  }
}
