import 'dart:async';
import '../models/multi_currency_wallet_model.dart';

class CrossBorderPaymentService {
  Future<List<CurrencyWallet>> getWallets() async {
    await Future.delayed(const Duration(seconds: 1));
    return [
      CurrencyWallet(currencyCode: 'USD', balance: 14500.00, flagAsset: '🇺🇸'),
      CurrencyWallet(currencyCode: 'CAD', balance: 4200.50, flagAsset: '🇨🇦'),
      CurrencyWallet(currencyCode: 'MXN', balance: 28500.00, flagAsset: '🇲🇽'),
    ];
  }

  Future<List<CrossBorderTransaction>> getRecentSettlements() async {
    await Future.delayed(const Duration(seconds: 1));
    return [
      CrossBorderTransaction(
        transactionId: 'TRX-88192-A',
        loadId: 'LD-Laredo-Monterrey',
        sourceCurrency: 'USD',
        sourceAmount: 1200.00,
        targetCurrency: 'MXN',
        targetAmount: 20280.00,
        exchangeRateApplied: 16.90, // mid-market rate
        savedFees: 45.00, // compared to wire transfer
        settledDate: DateTime.now().subtract(const Duration(hours: 4)),
      ),
      CrossBorderTransaction(
        transactionId: 'TRX-88155-B',
        loadId: 'LD-Detroit-Toronto',
        sourceCurrency: 'USD',
        sourceAmount: 850.00,
        targetCurrency: 'CAD',
        targetAmount: 1147.50,
        exchangeRateApplied: 1.35,
        savedFees: 32.00,
        settledDate: DateTime.now().subtract(const Duration(days: 2)),
      )
    ];
  }
}
