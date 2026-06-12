class VoiceAiOrderInput {
  final String? status;
  final String? eta;
  final String? dropAddress;

  const VoiceAiOrderInput({
    this.status,
    this.eta,
    this.dropAddress,
  });

  static VoiceAiOrderInput? fromMap(Map<String, dynamic>? map) {
    if (map == null) return null;
    return VoiceAiOrderInput(
      status: map['status']?.toString(),
      eta: map['eta']?.toString(),
      dropAddress: map['drop_address']?.toString(),
    );
  }
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

    if (eta != null) {
      return 'Your shipment is currently $status and expected to reach '
             '$dropAddress by $eta.';
    }

    return 'Your shipment is currently $status. '
           'ETA information is not yet available.';
  }
}
