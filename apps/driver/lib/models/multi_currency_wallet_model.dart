class CurrencyWallet {
  final String currencyCode; // USD, CAD, MXN
  final double balance;
  final String flagAsset;
  
  CurrencyWallet({
    required this.currencyCode,
    required this.balance,
    required this.flagAsset,
  });
}

class CrossBorderTransaction {
  final String transactionId;
  final String loadId;
  final String sourceCurrency;
  final double sourceAmount;
  final String targetCurrency;
  final double targetAmount;
  final double exchangeRateApplied;
  final double savedFees;
  final DateTime settledDate;

  CrossBorderTransaction({
    required this.transactionId,
    required this.loadId,
    required this.sourceCurrency,
    required this.sourceAmount,
    required this.targetCurrency,
    required this.targetAmount,
    required this.exchangeRateApplied,
    required this.savedFees,
    required this.settledDate,
  });
}
