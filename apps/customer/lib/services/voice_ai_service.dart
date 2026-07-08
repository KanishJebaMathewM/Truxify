class VoiceAiOrderInput {
  final String? status;
  final String? eta;
  final String? dropAddress;
  final String? pickupAddress;
  final String? driverName;
  final String? truckType;

  const VoiceAiOrderInput({
    this.status,
    this.eta,
    this.dropAddress,
    this.pickupAddress,
    this.driverName,
    this.truckType,
  });

  static VoiceAiOrderInput? fromMap(Map<String, dynamic>? map) {
    if (map == null) return null;
    return VoiceAiOrderInput(
      status: map['status']?.toString(),
      eta: map['eta']?.toString(),
      dropAddress: map['drop_address']?.toString(),
      pickupAddress: map['pickup_address']?.toString(),
      driverName: map['driver_name']?.toString(),
      truckType: map['truck_type']?.toString(),
    );
  }

  bool get hasDetailedInfo =>
      driverName != null ||
      truckType != null ||
      pickupAddress != null;
}

class VoiceAiService {
  static String formatStatus(String? rawStatus) {
    final status = rawStatus?.trim().toLowerCase() ?? '';
    if (status.isEmpty) {
      return 'pending';
    }
    switch (status) {
      case 'driver_assigned':
        return 'driver assigned';
      case 'in_transit':
        return 'in transit';
      case 'payment_released':
        return 'payment released';
      case 'completed':
      case 'delivered':
        return 'delivered';
      case 'cancelled':
        return 'cancelled';
      case 'pending':
        return 'pending';
      default:
        return status.replaceAll('_', ' ');
    }
  }

  static String buildResponse(VoiceAiOrderInput? order) {
    if (order == null) {
      return 'Loading your shipment details…';
    }

    final rawEta = order.eta?.trim();
    final eta = (rawEta != null && rawEta.isNotEmpty) ? rawEta : null;

    final rawStatus = order.status?.trim() ?? '';
    final status = formatStatus(rawStatus.isNotEmpty ? rawStatus : 'pending');

    final rawDropAddress = order.dropAddress?.trim();
    final dropAddress = (rawDropAddress != null && rawDropAddress.isNotEmpty)
        ? rawDropAddress
        : 'your destination';

    final rawPickup = order.pickupAddress?.trim();
    final pickup = (rawPickup != null && rawPickup.isNotEmpty) ? rawPickup : null;

    final parts = <String>[];
    parts.add('Your shipment is currently $status.');

    if (order.driverName != null) {
      parts.add('Your driver is ${order.driverName}.');
    }
    if (order.truckType != null) {
      parts.add('Truck type: ${order.truckType}.');
    }
    if (pickup != null) {
      parts.add('Pickup location: $pickup.');
    }
    if (eta != null) {
      parts.add('Expected to reach $dropAddress by $eta.');
    } else {
      parts.add('ETA information is not yet available.');
    }

    return parts.join(' ');
  }

  static String buildSummary(VoiceAiOrderInput order) {
    final sb = StringBuffer('Order Summary: ');
    if (order.status != null) sb.write('Status: ${formatStatus(order.status)}. ');
    if (order.pickupAddress != null) sb.write('Pickup: ${order.pickupAddress}. ');
    if (order.dropAddress != null) sb.write('Drop: ${order.dropAddress}. ');
    if (order.driverName != null) sb.write('Driver: ${order.driverName}. ');
    if (order.eta != null) sb.write('ETA: ${order.eta}.');
    return sb.toString();
  }
}
