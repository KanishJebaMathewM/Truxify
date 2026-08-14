class LumperInvoice {
  final String warehouseName;
  final double feeAmountUsd;
  final String loadId;
  final bool isVerified;

  LumperInvoice({
    required this.warehouseName,
    required this.feeAmountUsd,
    required this.loadId,
    required this.isVerified,
  });
}

class VirtualDebitCard {
  final String cardNumber;
  final String expiration;
  final String cvv;
  final double authorizedAmountUsd;
  final String status; // "Active", "Declined", "Charged"

  VirtualDebitCard({
    required this.cardNumber,
    required this.expiration,
    required this.cvv,
    required this.authorizedAmountUsd,
    required this.status,
  });
}
