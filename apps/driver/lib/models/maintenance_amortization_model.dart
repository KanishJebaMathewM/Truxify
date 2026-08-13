class MaintenanceItem {
  final String componentName;
  final double replacementCost;
  final int lifecycleMiles;
  final double costPerMile;

  MaintenanceItem({
    required this.componentName,
    required this.replacementCost,
    required this.lifecycleMiles,
    required this.costPerMile,
  });
}

class AmortizedLoad {
  final String loadId;
  final String origin;
  final String destination;
  final double miles;
  final double grossRevenue;
  final double maintenanceReserveCost;
  final double amortizedNetProfit;

  AmortizedLoad({
    required this.loadId,
    required this.origin,
    required this.destination,
    required this.miles,
    required this.grossRevenue,
    required this.maintenanceReserveCost,
    required this.amortizedNetProfit,
  });
}

class MaintenanceAmortizationSession {
  final String status;
  final List<MaintenanceItem> vehicleComponents;
  final double totalMaintenanceCPM;
  final List<AmortizedLoad> simulatedLoads;
  final bool isCalculating;

  MaintenanceAmortizationSession({
    required this.status,
    required this.vehicleComponents,
    required this.totalMaintenanceCPM,
    required this.simulatedLoads,
    required this.isCalculating,
  });
}
