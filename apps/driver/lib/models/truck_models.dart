class Truck {
  const Truck({
    required this.id,
    required this.driverId,
    required this.name,
    required this.numberPlate,
    required this.maxCapacityTons,
    required this.fuelLevelPct,
    required this.engineHealthPct,
    required this.avgTyrePressurePsi,
    required this.tpmsConnected,
    required this.insuranceExpiry,
    required this.pucExpiry,
    required this.permitExpiry,
  });

  final String id;
  final String driverId;
  final String name;
  final String numberPlate;
  final double maxCapacityTons;
  final double fuelLevelPct;
  final double engineHealthPct;
  final double avgTyrePressurePsi;
  final bool tpmsConnected;
  final DateTime? insuranceExpiry;
  final DateTime? pucExpiry;
  final DateTime? permitExpiry;

  factory Truck.fromJson(Map<String, dynamic> json) {
    return Truck(
      id: json['id'] as String,
      driverId: json['driver_id'] as String,
      name: json['name'] as String,
      numberPlate: json['number_plate'] as String,
      maxCapacityTons: (json['max_capacity_tons'] as num?)?.toDouble() ?? 0.0,
      fuelLevelPct: (json['fuel_level_pct'] as num?)?.toDouble() ?? 0.0,
      engineHealthPct: (json['engine_health_pct'] as num?)?.toDouble() ?? 0.0,
      avgTyrePressurePsi: (json['avg_tyre_pressure_psi'] as num?)?.toDouble() ?? 0.0,
      tpmsConnected: json['tpms_connected'] as bool? ?? false,
      insuranceExpiry: json['insurance_expiry'] != null
          ? DateTime.tryParse(json['insurance_expiry'] as String)
          : null,
      pucExpiry: json['puc_expiry'] != null
          ? DateTime.tryParse(json['puc_expiry'] as String)
          : null,
      permitExpiry: json['permit_expiry'] != null
          ? DateTime.tryParse(json['permit_expiry'] as String)
          : null,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'driver_id': driverId,
      'name': name,
      'number_plate': numberPlate,
      'max_capacity_tons': maxCapacityTons,
      'fuel_level_pct': fuelLevelPct,
      'engine_health_pct': engineHealthPct,
      'avg_tyre_pressure_psi': avgTyrePressurePsi,
      'tpms_connected': tpmsConnected,
      'insurance_expiry': insuranceExpiry?.toIso8601String(),
      'puc_expiry': pucExpiry?.toIso8601String(),
      'permit_expiry': permitExpiry?.toIso8601String(),
    };
  }
}

class TyreDiagnostic {
  const TyreDiagnostic({
    required this.truckId,
    required this.position,
    required this.pressurePsi,
    required this.status,
  });

  final String truckId;
  final String position;
  final double pressurePsi;
  final String status;

  factory TyreDiagnostic.fromJson(Map<String, dynamic> json) {
    return TyreDiagnostic(
      truckId: json['truck_id'] as String,
      position: json['position'] as String,
      pressurePsi: (json['pressure_psi'] as num?)?.toDouble() ?? 0.0,
      status: json['status'] as String,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'truck_id': truckId,
      'position': position,
      'pressure_psi': pressurePsi,
      'status': status,
    };
  }
}

class TruckMaintenanceTicket {
  const TruckMaintenanceTicket({
    required this.id,
    required this.truckId,
    required this.driverId,
    required this.category,
    required this.description,
    required this.status,
    this.createdAt,
  });

  final String id;
  final String truckId;
  final String driverId;
  final String category;
  final String description;
  final String status;
  final DateTime? createdAt;

  factory TruckMaintenanceTicket.fromJson(Map<String, dynamic> json) {
    return TruckMaintenanceTicket(
      id: json['id'] as String,
      truckId: json['truck_id'] as String,
      driverId: json['driver_id'] as String,
      category: json['category'] as String,
      description: json['description'] as String,
      status: json['status'] as String,
      createdAt: json['created_at'] != null
          ? DateTime.tryParse(json['created_at'] as String)
          : null,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'truck_id': truckId,
      'driver_id': driverId,
      'category': category,
      'description': description,
      'status': status,
      if (createdAt != null) 'created_at': createdAt?.toIso8601String(),
    };
  }
}
