class AddressHelper {
  static String shortDisplay(String addr) => addr.length > 30 ? '${addr.substring(0, 27)}...' : addr;
  static String labelWithAddr(String label, String addr) => label.isNotEmpty ? '$label: ${shortDisplay(addr)}' : shortDisplay(addr);
  static bool sameAddress(String a, String b) => a.trim().toLowerCase() == b.trim().toLowerCase();
  static Map<String, dynamic> toJson(String label, double lat, double lng, String addr) => {'label': label, 'latitude': lat, 'longitude': lng, 'address': addr, 'created_at': DateTime.now().toIso8601String()};

  static String formatPincode(String pincode) => pincode.replaceAll(RegExp(r'[^0-9]'), '');
  static bool isValidPincode(String pincode) => RegExp(r'^\d{6}$').hasMatch(pincode);
  static String cityState(String city, String state) => [city, state].where((s) => s.isNotEmpty).join(', ');
  static String fullAddress(String addr, String city, String state, String pincode) {
    final parts = [addr, city, state, pincode].where((s) => s.isNotEmpty);
    return parts.join(', ');
  }
}

class SavedAddress {
  final String id;
  final String userId;
  final String label;
  final String addressLine;
  final String city;
  final String state;
  final String pincode;
  final double? latitude;
  final double? longitude;
  final bool isDefault;

  const SavedAddress({
    required this.id,
    required this.userId,
    required this.label,
    required this.addressLine,
    required this.city,
    required this.state,
    required this.pincode,
    this.latitude,
    this.longitude,
    required this.isDefault,
  });

  String get fullAddress => '$addressLine, $city, $state $pincode';

  factory SavedAddress.fromMap(Map<String, dynamic> map) {
    return SavedAddress(
      id: map['id'] as String,
      userId: map['user_id'] as String,
      label: map['label'] as String,
      addressLine: map['address_line'] as String,
      city: map['city'] as String,
      state: map['state'] as String,
      pincode: map['pincode'] as String,
      latitude: (map['latitude'] as num?)?.toDouble(),
      longitude: (map['longitude'] as num?)?.toDouble(),
      isDefault: map['is_default'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'user_id': userId,
      'label': label,
      'address_line': addressLine,
      'city': city,
      'state': state,
      'pincode': pincode,
      if (latitude != null) 'latitude': latitude,
      if (longitude != null) 'longitude': longitude,
      'is_default': isDefault,
    };
  }

  SavedAddress copyWith({bool? isDefault}) {
    return SavedAddress(
      id: id,
      userId: userId,
      label: label,
      addressLine: addressLine,
      city: city,
      state: state,
      pincode: pincode,
      latitude: latitude,
      longitude: longitude,
      isDefault: isDefault ?? this.isDefault,
    );
  }
}
