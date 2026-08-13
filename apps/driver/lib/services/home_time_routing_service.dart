import 'dart:async';
import '../models/home_time_routing_model.dart';

class HomeTimeRoutingService {
  final _sessionController = StreamController<HomeTimeRouteSession>.broadcast();
  
  Stream<HomeTimeRouteSession> get routingStream => _sessionController.stream;

  void initializeDashboard() {
    _emitState('Awaiting Routing Parameters', 'Mike H. (Truck 114)', '30301 (Atlanta, GA)', DateTime.now(), [], 0.0, false);
  }

  void computeHomeTimeRoute(DateTime targetDate) async {
    _emitState('Querying National Load Board...', 'Mike H. (Truck 114)', '30301 (Atlanta, GA)', targetDate, [], 0.0, true);

    await Future.delayed(const Duration(seconds: 1));
    
    _emitState('Running Dijkstra Graph Search...', 'Mike H. (Truck 114)', '30301 (Atlanta, GA)', targetDate, [], 0.0, true);

    await Future.delayed(const Duration(seconds: 1));

    List<RoutingLeg> sequence = [
      RoutingLeg(sequenceNumber: 1, origin: 'Chicago, IL', destination: 'Columbus, OH', payout: 1250.00, miles: 350, estimatedArrival: 'Wednesday 14:00'),
      RoutingLeg(sequenceNumber: 2, origin: 'Columbus, OH', destination: 'Charlotte, NC', payout: 1800.00, miles: 420, estimatedArrival: 'Thursday 17:30'),
      RoutingLeg(sequenceNumber: 3, origin: 'Charlotte, NC', destination: 'Atlanta, GA (HOME)', payout: 950.00, miles: 245, estimatedArrival: 'Friday 12:15'), // Made it home!
    ];

    double totalPayout = sequence.fold(0, (sum, leg) => sum + leg.payout);

    _emitState('Graph Search Complete', 'Mike H. (Truck 114)', '30301 (Atlanta, GA)', targetDate, sequence, totalPayout, false);
  }

  void _emitState(String status, String driver, String zip, DateTime target, List<RoutingLeg> seq, double total, bool computing) {
    _sessionController.add(HomeTimeRouteSession(
      status: status,
      driverName: driver,
      homeZipCode: zip,
      targetHomeDate: target,
      optimizedSequence: List.from(seq),
      totalSequencePayout: total,
      isComputing: computing,
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
