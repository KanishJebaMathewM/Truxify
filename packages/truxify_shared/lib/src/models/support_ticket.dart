class SupportTicket {
  const SupportTicket({
    required this.id,
    required this.userId,
    required this.subject,
    required this.description,
    required this.category,
    required this.status,
  });

  final String id;
  final String? userId;
  final String subject;
  final String description;
  final String category;
  final String status;

  Map<String, dynamic> toInsertMap() => {
        'user_id': userId,
        'subject': subject,
        'description': description,
        'category': category,
        'status': status,
      };
}

