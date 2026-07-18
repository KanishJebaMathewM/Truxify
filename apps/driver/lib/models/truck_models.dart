class Truck {
  const Truck({
    required this.id,
    required this.driverId,
    required this.name,
    required this.numberPlate,
    required this.maxCapacityTons,
    required this.insuranceExpiry,
    required this.pucExpiry,
    required this.permitExpiry,
  });

  final String id;
  final String driverId;
  final String name;
  final String numberPlate;
  final double maxCapacityTons;
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
      'insurance_expiry': insuranceExpiry?.toIso8601String(),
      'puc_expiry': pucExpiry?.toIso8601String(),
      'permit_expiry': permitExpiry?.toIso8601String(),
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
    this.photoUrls = const [],
  });

  final String id;
  final String truckId;
  final String driverId;
  final String category;
  final String description;
  final String status;
  final DateTime? createdAt;
  final List<String> photoUrls;

  factory TruckMaintenanceTicket.fromJson(Map<String, dynamic> json) {
    return TruckMaintenanceTicket(
      id: json['id'].toString(),
      truckId: json['truck_id'].toString(),
      driverId: json['driver_id'].toString(),
      category: json['category'] as String,
      description: json['description'] as String,
      status: json['status'] as String,
      createdAt: json['created_at'] != null
          ? DateTime.tryParse(json['created_at'] as String)
          : null,
      photoUrls: json['photo_urls'] != null
          ? List<String>.from(json['photo_urls'] as List)
          : const [],
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
      'photo_urls': photoUrls,
    };
  }
}
