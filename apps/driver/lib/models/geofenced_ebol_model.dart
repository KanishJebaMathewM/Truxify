class GeofencedLocation {
  final double latitude;
  final double longitude;
  final double radiusMeters;
  final String facilityName;

  GeofencedLocation({
    required this.latitude,
    required this.longitude,
    required this.radiusMeters,
    required this.facilityName,
  });
}

class EbolDocument {
  final String bolId;
  final String loadDescription;
  final GeofencedLocation deliveryLocation;
  final bool isGeofenceVerified;
  final bool isSigned;
  final DateTime? signedAt;
  final String? signatureHash;

  EbolDocument({
    required this.bolId,
    required this.loadDescription,
    required this.deliveryLocation,
    required this.isGeofenceVerified,
    required this.isSigned,
    this.signedAt,
    this.signatureHash,
  });

  EbolDocument copyWith({
    bool? isGeofenceVerified,
    bool? isSigned,
    DateTime? signedAt,
    String? signatureHash,
  }) {
    return EbolDocument(
      bolId: bolId,
      loadDescription: loadDescription,
      deliveryLocation: deliveryLocation,
      isGeofenceVerified: isGeofenceVerified ?? this.isGeofenceVerified,
      isSigned: isSigned ?? this.isSigned,
      signedAt: signedAt ?? this.signedAt,
      signatureHash: signatureHash ?? this.signatureHash,
    );
  }
}
