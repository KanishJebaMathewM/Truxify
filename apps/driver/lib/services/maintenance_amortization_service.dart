import 'dart:async';
import '../models/maintenance_amortization_model.dart';

class MaintenanceAmortizationService {
  final _sessionController = StreamController<MaintenanceAmortizationSession>.broadcast();
  
  Stream<MaintenanceAmortizationSession> get amortizationStream => _sessionController.stream;

  void initializeDashboard() {
    _emitState('Awaiting Accounting Input', [], 0.0, [], false);
  }

  void runAmortizationEngine() async {
    _emitState('Calculating Vehicle Depreciation Matrix...', [], 0.0, [], true);

    await Future.delayed(const Duration(seconds: 1));
    
    _emitState('Amortizing Load Board Profitability...', [], 0.0, [], true);

    await Future.delayed(const Duration(seconds: 1));

    List<MaintenanceItem> components = [
      MaintenanceItem(componentName: 'Drive Tires (x8)', replacementCost: 3200.0, lifecycleMiles: 120000, costPerMile: 0.026),
      MaintenanceItem(componentName: 'Engine Overhaul', replacementCost: 15000.0, lifecycleMiles: 500000, costPerMile: 0.030),
      MaintenanceItem(componentName: 'Transmission Replace', replacementCost: 8500.0, lifecycleMiles: 750000, costPerMile: 0.011),
      MaintenanceItem(componentName: 'Oil Changes / PM', replacementCost: 450.0, lifecycleMiles: 15000, costPerMile: 0.030),
    ];

    double totalCpm = components.fold(0.0, (sum, item) => sum + item.costPerMile);

    List<AmortizedLoad> loads = [
      AmortizedLoad(
        loadId: 'LD-922',
        origin: 'Atlanta, GA',
        destination: 'Dallas, TX',
        miles: 800.0,
        grossRevenue: 1800.0,
        maintenanceReserveCost: 800.0 * totalCpm,
        amortizedNetProfit: 1800.0 - (800.0 * totalCpm),
      ),
      AmortizedLoad(
        loadId: 'LD-410',
        origin: 'Chicago, IL',
        destination: 'Denver, CO',
        miles: 1000.0,
        grossRevenue: 1500.0,
        maintenanceReserveCost: 1000.0 * totalCpm,
        amortizedNetProfit: 1500.0 - (1000.0 * totalCpm),
      )
    ];

    _emitState('Depreciation Accounting Complete', components, totalCpm, loads, false);
  }

  void _emitState(String status, List<MaintenanceItem> components, double totalCpm, List<AmortizedLoad> loads, bool isCalculating) {
    _sessionController.add(MaintenanceAmortizationSession(
      status: status,
      vehicleComponents: List.from(components),
      totalMaintenanceCPM: totalCpm,
      simulatedLoads: List.from(loads),
      isCalculating: isCalculating,
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
