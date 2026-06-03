class Faq {
  const Faq({
    required this.id,
    required this.appType,
    required this.question,
    required this.answer,
    required this.sortOrder,
    required this.isActive,
  });

  final String id;
  final String appType;
  final String question;
  final String answer;
  final int sortOrder;
  final bool isActive;

  factory Faq.fromMap(Map<String, dynamic> map) {
    return Faq(
      id: map['id']?.toString() ?? '',
      appType: map['app_type']?.toString() ?? 'both',
      question: map['question']?.toString() ?? '',
      answer: map['answer']?.toString() ?? '',
      sortOrder: (map['sort_order'] as num?)?.toInt() ?? 0,
      isActive: map['is_active'] as bool? ?? true,
    );
  }
}

