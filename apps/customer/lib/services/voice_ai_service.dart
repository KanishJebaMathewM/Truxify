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

    final eta = order['eta']?.toString();
    final rawStatus = order['status']?.toString() ?? 'in_transit';
    final status = formatStatus(rawStatus);
    final dropAddress = order['drop_address']?.toString() ?? 'your destination';

    if (eta != null && eta.isNotEmpty) {
      return 'Your shipment is currently $status and expected to reach '
             '$dropAddress by $eta.';
    }

    return 'Your shipment is currently $status. '
           'ETA information is not yet available.';
  }
}
