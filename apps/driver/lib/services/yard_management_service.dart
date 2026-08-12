import 'dart:async';
import 'dart:math';
import '../models/yard_assignment_model.dart';

class YardManagementService {
  final _controller = StreamController<YardAssignment>.broadcast();
  Timer? _timer;

  Stream<YardAssignment> streamYardNavigation(String facilityName) {
    _startSimulation(facilityName);
    return _controller.stream;
  }

  void _startSimulation(String facilityName) {
    _timer?.cancel();
    
    double currentDistance = 500.0; // Start 500 meters away at the gate

    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (currentDistance <= 0) {
        _controller.add(_createAssignment(facilityName, 0, 'At Destination'));
        timer.cancel();
        return;
      }

      currentDistance -= (Random().nextDouble() * 10 + 5); // Move closer 5-15 meters per sec
      if (currentDistance < 0) currentDistance = 0;

      String status = currentDistance > 450 ? 'Pending Entry' : 'Navigating Yard';
      
      _controller.add(_createAssignment(facilityName, currentDistance, status));
    });
  }

  YardAssignment _createAssignment(String facilityName, double distance, String status) {
    return YardAssignment(
      facilityName: facilityName,
      assignmentType: 'Live Load',
      targetId: 'Dock Door 42-B',
      latitude: 41.8781,
      longitude: -87.6298,
      status: status,
      distanceToTargetMeters: distance,
      instructions: 'Proceed past guard shack, take 2nd left, dock is on the right side.',
    );
  }

  void dispose() {
    _timer?.cancel();
    _controller.close();
  }
}
