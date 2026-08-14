import 'dart:async';
import '../models/predictive_maintenance_model.dart';

class PredictiveMaintenanceService {
  final _sessionController = StreamController<PredictiveMaintenanceSession>.broadcast();

  Stream<PredictiveMaintenanceSession> get maintenanceStream => _sessionController.stream;

  void calculateMaintenanceSchedule() async {
    _sessionController.add(PredictiveMaintenanceSession(
      status: 'Analyzing Fleet Telemetry...',
      upcomingTasks: [],
      overdueTasks: [],
    ));

    await Future.delayed(const Duration(seconds: 2));

    _sessionController.add(PredictiveMaintenanceSession(
      status: 'Maintenance Calendar Optimized',
      overdueTasks: [
        MaintenanceTask(taskId: 'M-101', truckId: 'TRK-992', taskName: 'DOT Annual Inspection', currentMiles: 145000, dueAtMiles: 144500, priority: 'High'),
      ],
      upcomingTasks: [
        MaintenanceTask(taskId: 'M-102', truckId: 'TRK-881', taskName: 'Synthetic Oil Change', currentMiles: 42000, dueAtMiles: 45000, priority: 'Medium'),
        MaintenanceTask(taskId: 'M-103', truckId: 'TRK-774', taskName: 'Tandem Brake Pad Check', currentMiles: 89000, dueAtMiles: 95000, priority: 'Low'),
        MaintenanceTask(taskId: 'M-104', truckId: 'TRK-221', taskName: 'Tire Rotation', currentMiles: 110500, dueAtMiles: 115000, priority: 'Low'),
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
