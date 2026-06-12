class VoiceAiService {
  static String formatStatus(String status) {
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

  static String buildResponse(Map<String, dynamic>? order) {
    if (order == null) {
      return 'Loading your shipment details…';
    }

    final rawEta = order['eta']?.toString().trim();
    final eta = (rawEta != null && rawEta.isNotEmpty) ? rawEta : null;

    final rawStatus = order['status']?.toString().trim() ?? '';
    final status = formatStatus(rawStatus.isNotEmpty ? rawStatus : 'pending');

    final rawDropAddress = order['drop_address']?.toString().trim();
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
