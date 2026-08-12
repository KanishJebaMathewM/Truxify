import 'dart:async';
import '../models/platoon_match_model.dart';

class PlatoonRoutingService {
  /// Simulates scanning active Truxify routes for platooning opportunities
  Future<List<PlatoonMatch>> findPlatoonMatches() async {
    await Future.delayed(const Duration(seconds: 2));

    return [
      PlatoonMatch(
        driverName: 'Sarah Jenkins',
        truckId: 'TX-9844',
        commonRouteSegment: 'I-80 West (340 miles)',
        milesToMergePoint: 15,
        estimatedFuelSavingsPercent: 11,
        status: 'Available',
      ),
      PlatoonMatch(
        driverName: 'Marcus Cole',
        truckId: 'TX-1120',
        commonRouteSegment: 'I-80 West (210 miles)',
        milesToMergePoint: 45,
        estimatedFuelSavingsPercent: 8,
        status: 'Available',
      ),
    ];
  }

  Future<PlatoonMatch> requestPlatoonLink(PlatoonMatch match) async {
    await Future.delayed(const Duration(seconds: 2));
    
    return PlatoonMatch(
      driverName: match.driverName,
      truckId: match.truckId,
      commonRouteSegment: match.commonRouteSegment,
      milesToMergePoint: match.milesToMergePoint,
      estimatedFuelSavingsPercent: match.estimatedFuelSavingsPercent,
      status: 'Linked',
    );
  }
}
