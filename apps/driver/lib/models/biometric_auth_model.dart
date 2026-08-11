class HighValueFreightSecurity {
  final String loadId;
  final String freightType; // e.g. 'Pharmaceuticals', 'Electronics'
  final bool isIoTSealLocked;
  final String iotSealMacAddress;
  final int requiredAuthenticationLevel; // 1: Password, 2: Fingerprint, 3: Facial Recognition + Fingerprint

  HighValueFreightSecurity({
    required this.loadId,
    required this.freightType,
    required this.isIoTSealLocked,
    required this.iotSealMacAddress,
    required this.requiredAuthenticationLevel,
  });
}
