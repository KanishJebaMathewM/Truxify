import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/multi_currency_wallet_model.dart';
import '../services/cross_border_payment_service.dart';

class MultiCurrencyWalletScreen extends StatefulWidget {
  const MultiCurrencyWalletScreen({super.key});

  @override
  State<MultiCurrencyWalletScreen> createState() => _MultiCurrencyWalletScreenState();
}

class _MultiCurrencyWalletScreenState extends State<MultiCurrencyWalletScreen> {
  final CrossBorderPaymentService _paymentService = CrossBorderPaymentService();
  List<CurrencyWallet> _wallets = [];
  List<CrossBorderTransaction> _transactions = [];
  bool _isLoading = true;
  final NumberFormat _currencyFormat = NumberFormat.currency(symbol: '\$');

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  void _loadData() async {
    final wallets = await _paymentService.getWallets();
    final txs = await _paymentService.getRecentSettlements();
    if (mounted) {
      setState(() {
        _wallets = wallets;
        _transactions = txs;
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Cross-Border Wallets'),
        backgroundColor: Colors.teal[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildTotalBalance(),
                  const SizedBox(height: 16),
                  const Text('Holdings', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                  const SizedBox(height: 8),
                  _buildWalletsList(),
                  const SizedBox(height: 24),
                  const Text('Recent Settlements (Mid-Market Rate)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                  const SizedBox(height: 8),
                  _buildTransactionsList(),
                ],
              ),
            ),
    );
  }

  Widget _buildTotalBalance() {
    // Mock calculation of total balance in USD for display
    double totalUsd = _wallets.firstWhere((w) => w.currencyCode == 'USD').balance +
                      (_wallets.firstWhere((w) => w.currencyCode == 'CAD').balance / 1.35) +
                      (_wallets.firstWhere((w) => w.currencyCode == 'MXN').balance / 16.90);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        gradient: LinearGradient(colors: [Colors.teal[800]!, Colors.teal[600]!]),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Total Global Balance (USD Equivalent)', style: TextStyle(color: Colors.white70)),
          const SizedBox(height: 8),
          Text(_currencyFormat.format(totalUsd), style: const TextStyle(color: Colors.white, fontSize: 36, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          Row(
            children: [
              Icon(Icons.flash_on, color: Colors.yellow[400], size: 16),
              const SizedBox(width: 4),
              const Text('Instant payouts active', style: TextStyle(color: Colors.white, fontSize: 12)),
            ],
          )
        ],
      ),
    );
  }

  Widget _buildWalletsList() {
    return Column(
      children: _wallets.map((wallet) {
        return Card(
          margin: const EdgeInsets.only(bottom: 8),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          child: ListTile(
            leading: Text(wallet.flagAsset, style: const TextStyle(fontSize: 24)),
            title: Text('${wallet.currencyCode} Wallet', style: const TextStyle(fontWeight: FontWeight.bold)),
            trailing: Text(_currencyFormat.format(wallet.balance), style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          ),
        );
      }).toList(),
    );
  }

  Widget _buildTransactionsList() {
    return Column(
      children: _transactions.map((tx) {
        return Card(
          margin: const EdgeInsets.only(bottom: 12),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          child: Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Load: ${tx.loadId}', style: const TextStyle(fontWeight: FontWeight.bold)),
                    Text(DateFormat('MMM d').format(tx.settledDate), style: const TextStyle(color: Colors.grey)),
                  ],
                ),
                const Divider(),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Source', style: TextStyle(color: Colors.grey, fontSize: 12)),
                        Text('${_currencyFormat.format(tx.sourceAmount)} ${tx.sourceCurrency}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                      ],
                    ),
                    Icon(Icons.arrow_forward, color: Colors.teal[800]),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        const Text('Settled', style: TextStyle(color: Colors.grey, fontSize: 12)),
                        Text('${_currencyFormat.format(tx.targetAmount)} ${tx.targetCurrency}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.teal)),
                      ],
                    )
                  ],
                ),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(color: Colors.green[50], borderRadius: BorderRadius.circular(8)),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('Rate: ${tx.exchangeRateApplied}', style: TextStyle(color: Colors.green[800], fontSize: 12)),
                      Text('Saved ${_currencyFormat.format(tx.savedFees)} in wire fees', style: TextStyle(color: Colors.green[800], fontWeight: FontWeight.bold, fontSize: 12)),
                    ],
                  ),
                )
              ],
            ),
          ),
        );
      }).toList(),
    );
  }
}
