class PlatoonMatch {
  final String matchId;
  final String driverName;
  final String partnerDriverName;
  final String partnerCompany;
  final String truckId;
  final String commonRouteSegment;
  final String highwayRoute;
  final double distanceAheadMiles;
  final int milesToMergePoint;
  final double estimatedFuelSavingsPercent;
  final int matchingMiles;
  final String status; // 'Available', 'Requested', 'Linked', 'Active'

  PlatoonMatch({
    String? matchId,
    String? driverName,
    String? partnerDriverName,
    String? partnerCompany,
    String? truckId,
    String? commonRouteSegment,
    String? highwayRoute,
    double? distanceAheadMiles,
    int? milesToMergePoint,
    num? estimatedFuelSavingsPercent,
    int? matchingMiles,
    String? status,
  })  : matchId = matchId ?? 'PLT-${truckId ?? '0000'}',
        driverName = driverName ?? partnerDriverName ?? 'Unknown Driver',
        partnerDriverName = partnerDriverName ?? driverName ?? 'Unknown Driver',
        partnerCompany = partnerCompany ?? 'Truxify Network Fleet',
        truckId = truckId ?? matchId ?? 'TRX-TRUCK',
        commonRouteSegment = commonRouteSegment ?? highwayRoute ?? 'Corridor Route',
        highwayRoute = highwayRoute ?? commonRouteSegment ?? 'Corridor Route',
        distanceAheadMiles = distanceAheadMiles ?? (milesToMergePoint?.toDouble() ?? 0.0),
        milesToMergePoint = milesToMergePoint ?? distanceAheadMiles?.abs().toInt() ?? 0,
        estimatedFuelSavingsPercent = estimatedFuelSavingsPercent?.toDouble() ?? 8.0,
        matchingMiles = matchingMiles ?? milesToMergePoint ?? 100,
        status = status ?? 'Available';

  factory PlatoonMatch.fromJson(Map<String, dynamic> json) {
    return PlatoonMatch(
      matchId: json['matchId'] as String?,
      driverName: json['driverName'] as String?,
      partnerDriverName: json['partnerDriverName'] as String?,
      partnerCompany: json['partnerCompany'] as String?,
      truckId: json['truckId'] as String?,
      commonRouteSegment: json['commonRouteSegment'] as String?,
      highwayRoute: json['highwayRoute'] as String?,
      distanceAheadMiles: (json['distanceAheadMiles'] as num?)?.toDouble(),
      milesToMergePoint: json['milesToMergePoint'] as int?,
      estimatedFuelSavingsPercent: (json['estimatedFuelSavingsPercent'] as num?)?.toDouble(),
      matchingMiles: json['matchingMiles'] as int?,
      status: json['status'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'matchId': matchId,
      'driverName': driverName,
      'partnerDriverName': partnerDriverName,
      'partnerCompany': partnerCompany,
      'truckId': truckId,
      'commonRouteSegment': commonRouteSegment,
      'highwayRoute': highwayRoute,
      'distanceAheadMiles': distanceAheadMiles,
      'milesToMergePoint': milesToMergePoint,
      'estimatedFuelSavingsPercent': estimatedFuelSavingsPercent,
      'matchingMiles': matchingMiles,
      'status': status,
    };
  }
}
