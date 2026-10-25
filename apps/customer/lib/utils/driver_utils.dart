class DriverUtils {
  DriverUtils._();

  /// Checks if a string is a valid driver name (i.e. not a UUID and not empty).
  static bool isValidDriverName(String? name) {
    if (name == null || name.trim().isEmpty) return false;
    final uuidRegex = RegExp(
      r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
    );
    final trimmed = name.trim();
    if (uuidRegex.hasMatch(trimmed)) return false;
    // Permuted/reshuffled UUIDs (hex groups in any order) are still not names
    final looseUuid = RegExp(r'^[0-9a-fA-F]{4,}(?:-[0-9a-fA-F]{4,})+$');
    if (looseUuid.hasMatch(trimmed)) return false;
    return true;
  }

  /// Resolves the driver display name, falling back to 'Driver Assigned'
  /// if the name is a UUID or empty.
  static String resolveDriverName(Map<String, dynamic> order) {
    final profile = order['profiles'];
    if (profile is Map<String, dynamic>) {
      final name = profile['full_name']?.toString().trim();
      if (isValidDriverName(name)) return name!;
    }

    final driverName = order['driver_name']?.toString().trim();
    if (isValidDriverName(driverName)) return driverName!;

    return 'Driver Assigned';
  }
}
