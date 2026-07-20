class NotificationPayload {
  const NotificationPayload({
    required this.type,
    this.orderId,
    this.tripId,
    this.bidId,
    this.paymentId,
    this.supportTicketId,
    this.title,
    this.body,
    this.rawData = const {},
  });

  final String type;
  final String? orderId;
  final String? tripId;
  final String? bidId;
  final String? paymentId;
  final String? supportTicketId;
  final String? title;
  final String? body;
  final Map<String, dynamic> rawData;

  factory NotificationPayload.fromMap(Map<String, dynamic>? data) {
    if (data == null) {
      return const NotificationPayload(type: 'unknown');
    }

    return NotificationPayload(
      type: data['type']?.toString() ?? 'general_notification',
      orderId: data['order_id']?.toString(),
      tripId: data['trip_id']?.toString(),
      bidId: data['bid_id']?.toString(),
      paymentId: data['payment_id']?.toString(),
      supportTicketId: data['support_ticket_id']?.toString(),
      title: data['title']?.toString(),
      body: data['body']?.toString(),
      rawData: Map<String, dynamic>.from(data),
    );
  }

  Map<String, dynamic> toMap() => {
        'type': type,
        if (orderId != null) 'order_id': orderId,
        if (tripId != null) 'trip_id': tripId,
        if (bidId != null) 'bid_id': bidId,
        if (paymentId != null) 'payment_id': paymentId,
        if (supportTicketId != null) 'support_ticket_id': supportTicketId,
        if (title != null) 'title': title,
        if (body != null) 'body': body,
      };
}
