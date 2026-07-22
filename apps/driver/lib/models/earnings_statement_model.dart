class EarningsStatementModel {
  final String driverName;
  final String? driverPhone;
  final DateTime startDate;
  final DateTime endDate;
  final int totalTrips;
  final double totalEarnings;
  final double platformFees;
  final double netEarnings;
  final List<TripEarningRow> trips;

  EarningsStatementModel({
    required this.driverName,
    this.driverPhone,
    required this.startDate,
    required this.endDate,
    required this.totalTrips,
    required this.totalEarnings,
    required this.platformFees,
    required this.netEarnings,
    required this.trips,
  });

  factory EarningsStatementModel.fromJson(Map<String, dynamic> json) {
    final tripsList = (json['trips'] as List? ?? [])
        .map((t) => TripEarningRow.fromJson(t as Map<String, dynamic>))
        .toList();

    return EarningsStatementModel(
      driverName: json['driver_name'] as String? ?? 'Driver',
      driverPhone: json['driver_phone'] as String?,
      startDate: DateTime.parse(json['start_date'] as String),
      endDate: DateTime.parse(json['end_date'] as String),
      totalTrips: (json['total_trips'] as num?)?.toInt() ?? tripsList.length,
      totalEarnings: _parsePaisa(json['total_earnings']),
      platformFees: _parsePaisa(json['platform_fees']),
      netEarnings: _parsePaisa(json['net_earnings']),
      trips: tripsList,
    );
  }

  static double _parsePaisa(dynamic value) {
    if (value == null) return 0.0;
    if (value is num) return value / 100.0;
    return (double.tryParse(value.toString()) ?? 0.0) / 100.0;
  }

  Map<String, dynamic> toJson() => {
        'driver_name': driverName,
        'driver_phone': driverPhone,
        'start_date': startDate.toIso8601String().split('T').first,
        'end_date': endDate.toIso8601String().split('T').first,
        'total_trips': totalTrips,
        'total_earnings': (totalEarnings * 100).toInt(),
        'platform_fees': (platformFees * 100).toInt(),
        'net_earnings': (netEarnings * 100).toInt(),
        'trips': trips.map((t) => t.toJson()).toList(),
      };
}

class TripEarningRow {
  final String? tripId;
  final String? displayId;
  final DateTime? tripDate;
  final String? route;
  final String? customerName;
  final double earnings;
  final double? platformFee;

  TripEarningRow({
    this.tripId,
    this.displayId,
    this.tripDate,
    this.route,
    this.customerName,
    required this.earnings,
    this.platformFee,
  });

  factory TripEarningRow.fromJson(Map<String, dynamic> json) {
    return TripEarningRow(
      tripId: json['trip_id'] as String?,
      displayId: json['display_id'] as String?,
      tripDate: json['trip_date'] != null
          ? DateTime.tryParse(json['trip_date'] as String)
          : null,
      route: json['route'] as String? ?? json['route_label'] as String?,
      customerName: json['customer_name'] as String? ??
          json['customer_display_name'] as String?,
      earnings: EarningsStatementModel._parsePaisa(json['earnings']),
      platformFee: json['platform_fee'] != null
          ? EarningsStatementModel._parsePaisa(json['platform_fee'])
          : null,
    );
  }

  Map<String, dynamic> toJson() => {
        'trip_id': tripId,
        'display_id': displayId,
        'trip_date': tripDate?.toIso8601String().split('T').first,
        'route': route,
        'customer_name': customerName,
        'earnings': (earnings * 100).toInt(),
        'platform_fee': platformFee != null ? (platformFee! * 100).toInt() : null,
      };
}
