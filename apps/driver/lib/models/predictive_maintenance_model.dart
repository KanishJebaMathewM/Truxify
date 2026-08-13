class MaintenanceTask {
  final String taskId;
  final String truckId;
  final String taskName; // "Oil Change", "Brake Inspection", "DOT Annual"
  final int currentMiles;
  final int dueAtMiles;
  final String priority; // "High", "Medium", "Low"

  MaintenanceTask({
    required this.taskId,
    required this.truckId,
    required this.taskName,
    required this.currentMiles,
    required this.dueAtMiles,
    required this.priority,
  });

  int get milesRemaining => dueAtMiles - currentMiles;
}

class PredictiveMaintenanceSession {
  final String status;
  final List<MaintenanceTask> upcomingTasks;
  final List<MaintenanceTask> overdueTasks;

  PredictiveMaintenanceSession({
    required this.status,
    required this.upcomingTasks,
    required this.overdueTasks,
  });
}
