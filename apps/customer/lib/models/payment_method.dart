class PaymentHelper {
  static String detectBrand(String num) {
    if (num.startsWith('4')) return 'Visa';
    if (num.startsWith('5')) return 'Mastercard';
    if (num.startsWith('34') || num.startsWith('37')) return 'Amex';
    if (num.startsWith('6')) return 'RuPay';
    return 'Unknown';
  }
  static String maskNumber(String num) {
    if (num.length < 8) return '****';
    return '${num.substring(0, 4)} **** **** ${num.substring(num.length - 4)}';
  }
  static String iconAsset(String brand) => 'assets/icons/payment_${brand.toLowerCase()}.png';
  static bool isValidUpi(String id) => id.contains('@') && id.length > 5;
}

class PaymentMethod {
  final String id;
  final String userId;
  final String methodType;
  final String displayLabel;
  final String? provider;
  final bool isDefault;

  const PaymentMethod({
    required this.id,
    required this.userId,
    required this.methodType,
    required this.displayLabel,
    this.provider,
    required this.isDefault,
  });

  factory PaymentMethod.fromMap(Map<String, dynamic> map) {
    return PaymentMethod(
      id: map['id'] as String,
      userId: map['user_id'] as String,
      methodType: map['method_type'] as String,
      displayLabel: map['display_label'] as String,
      provider: map['provider'] as String?,
      isDefault: map['is_default'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'user_id': userId,
      'method_type': methodType,
      'display_label': displayLabel,
      if (provider != null) 'provider': provider,
      'is_default': isDefault,
    };
  }

  PaymentMethod copyWith({bool? isDefault}) {
    return PaymentMethod(
      id: id,
      userId: userId,
      methodType: methodType,
      displayLabel: displayLabel,
      provider: provider,
      isDefault: isDefault ?? this.isDefault,
    );
  }
}
