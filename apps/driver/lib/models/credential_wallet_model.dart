class DriverCredential {
  final String id;
  final String title;
  final String issuer;
  final DateTime expirationDate;
  final String cryptographicHash;
  final bool isVerified;
  final String credentialType; // 'CDL', 'Medical', 'TWIC'

  DriverCredential({
    required this.id,
    required this.title,
    required this.issuer,
    required this.expirationDate,
    required this.cryptographicHash,
    required this.isVerified,
    required this.credentialType,
  });
}
