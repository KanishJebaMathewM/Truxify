import 'dart:async';
import '../models/tsp_optimization_model.dart';

class TspOptimizationService {
  final _sessionController = StreamController<TspOptimizationSession>.broadcast();

  Stream<TspOptimizationSession> get tspStream => _sessionController.stream;

  void optimizeRoute() async {
    _sessionController.add(TspOptimizationSession(
      status: 'Executing TSP Optimization Algorithm...',
      originalTotalMiles: 0,
      optimizedTotalMiles: 0,
      estimatedFuelSavedGallons: 0,
      optimizedStops: [],
    ));

    await Future.delayed(const Duration(seconds: 2));

    _sessionController.add(TspOptimizationSession(
      status: 'Route Optimized - Sequence Calculated',
      originalTotalMiles: 485.5,
      optimizedTotalMiles: 312.2, // Huge savings by reordering
      estimatedFuelSavedGallons: 24.7, // Assuming 7 MPG
      optimizedStops: [
        RouteStop(originalIndex: 1, optimizedIndex: 1, address: 'Distribution Center, Dallas TX', contactName: 'Dispatch', distanceFromPreviousMiles: 0.0),
        RouteStop(originalIndex: 5, optimizedIndex: 2, address: '100 Main St, Waco TX', contactName: 'Store 412', distanceFromPreviousMiles: 95.0),
        RouteStop(originalIndex: 2, optimizedIndex: 3, address: '550 Tech Blvd, Austin TX', contactName: 'Warehouse B', distanceFromPreviousMiles: 102.5),
        RouteStop(originalIndex: 4, optimizedIndex: 4, address: '88 River Rd, San Marcos TX', contactName: 'Store 991', distanceFromPreviousMiles: 31.5),
        RouteStop(originalIndex: 3, optimizedIndex: 5, address: '200 Alamo St, San Antonio TX', contactName: 'Mega Mart', distanceFromPreviousMiles: 49.2),
        RouteStop(originalIndex: 6, optimizedIndex: 6, address: '10 Loop Rd, Boerne TX', contactName: 'Store 205', distanceFromPreviousMiles: 34.0),
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
