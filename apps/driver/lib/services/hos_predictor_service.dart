import 'dart:async';
import '../models/hos_predictor_model.dart';

class HosPredictorService {
  final _sessionController = StreamController<HosPredictorSession>.broadcast();
  
  Stream<HosPredictorSession> get predictorStream => _sessionController.stream;

  void initializeDashboard() {
    _emitState('Awaiting Dispatch Input', null, null, false);
  }

  void simulateAssignment(String loadId, double distanceMiles) async {
    _emitState('Reading Electronic Logbook State...', null, null, true);

    await Future.delayed(const Duration(seconds: 1));
    
    HosDriverState mockDriver = HosDriverState(
      driverName: 'John Doe (Truck 402)',
      hoursRemainingDaily: 9.5,
      hoursRemainingWeekly: 10.0, // Only 10 hours left on 70-hour clock
      isInViolation: false,
    );
    
    _emitState('Calculating Required Transit Time...', mockDriver, null, true);

    await Future.delayed(const Duration(seconds: 1));

    // Assume average speed of 55 MPH
    double requiredHours = distanceMiles / 55.0;
    
    bool isViolation = requiredHours > mockDriver.hoursRemainingWeekly;
    String reason = isViolation 
        ? 'Load requires ${requiredHours.toStringAsFixed(1)} hours of driving, but driver only has ${mockDriver.hoursRemainingWeekly.toStringAsFixed(1)} hours left on their 70-hour federal weekly clock.' 
        : 'Driver has sufficient hours to complete this load legally.';

    HosSimulationResult result = HosSimulationResult(
      loadId: loadId,
      requiredTransitHours: requiredHours,
      isViolationInevitable: isViolation,
      violationReason: reason,
    );

    _emitState('Simulation Complete', mockDriver, result, false);
  }

  void _emitState(String status, HosDriverState? driver, HosSimulationResult? result, bool isSimulating) {
    _sessionController.add(HosPredictorSession(
      status: status,
      driverState: driver,
      simulationResult: result,
      isSimulating: isSimulating,
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
