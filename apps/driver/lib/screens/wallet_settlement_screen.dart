import 'package:flutter/material.dart';
import '../models/smart_contract_payment_model.dart';
import '../services/smart_contract_payment_service.dart';

class WalletSettlementScreen extends StatefulWidget {
  const WalletSettlementScreen({super.key, this.paymentService});

  /// Injection seam for tests. Defaults to the real blockchain-backed service.
  final SmartContractPaymentService? paymentService;

  @override
  State<WalletSettlementScreen> createState() => _WalletSettlementScreenState();
}

class _WalletSettlementScreenState extends State<WalletSettlementScreen> {
  late final SmartContractPaymentService _paymentService =
      widget.paymentService ?? SmartContractPaymentService();
  List<SmartContractPayment> _contracts = [];
  bool _isLoading = true;

  /// Contracts with a settlement call currently in flight. Guards against a
  /// double tap landing two `executeSmartContract` calls on the same escrow
  /// before the modal barrier is mounted.
  final Set<String> _settlingContractIds = {};

  @override
  void initState() {
    super.initState();
    _loadContracts();
  }

  void _loadContracts() async {
    final contracts = await _paymentService.getActiveContracts();
    if (mounted) {
      setState(() {
        _contracts = contracts;
        _isLoading = false;
      });
    }
  }

  Future<void> _signBolAndSettle(SmartContractPayment contract) async {
    // Idempotent entry: an already-settled escrow has nothing left to release,
    // and a contract mid-settlement must not be executed twice. Re-entry is a
    // no-op rather than a second on-chain payout.
    if (contract.status == 'Settled' ||
        !_settlingContractIds.add(contract.contractId)) {
      return;
    }

    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => const AlertDialog(
        content: Row(
          children: [
            CircularProgressIndicator(),
            SizedBox(width: 16),
            Expanded(child: Text('Executing Smart Contract on Blockchain...')),
          ],
        ),
      ),
    );

    try {
      final settledContract =
          await _paymentService.executeSmartContract(contract);

      if (!mounted) return;
      setState(() {
        final index =
            _contracts.indexWhere((c) => c.contractId == contract.contractId);
        if (index != -1) {
          _contracts[index] = settledContract;
        }
      });

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
              'Contract Settled! \$${settledContract.amountUsd} deposited to wallet.'),
          backgroundColor: Colors.green,
        ),
      );
    } catch (e) {
      debugPrint('Settlement failed: $e');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Settlement failed: $e. Please tap the button to retry.'),
          backgroundColor: Colors.red,
        ),
      );
    } finally {
      // Released on every exit path so a failed settlement stays retryable.
      _settlingContractIds.remove(contract.contractId);
      // Always close the non-dismissible dialog, even when the call throws,
      // so the driver is never stuck on a permanently spinning barrier.
      if (mounted) {
        Navigator.of(context).pop();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Smart Contract Wallet'),
        backgroundColor: Colors.indigo[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                _buildWalletHeader(),
                Expanded(
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _contracts.length,
                    itemBuilder: (context, index) {
                      return _buildContractCard(_contracts[index]);
                    },
                  ),
                )
              ],
            ),
    );
  }

  Widget _buildWalletHeader() {
    final totalBalance = _contracts
        .where((c) => c.status == 'Settled' || c.status == 'Settling')
        .fold<double>(0.0, (sum, c) => sum + c.amountUsd);
    final formattedBalance = '\$${totalBalance.toStringAsFixed(2)}';
    final formattedUsdc = '${totalBalance.toStringAsFixed(2)} USDC';
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(32),
      color: Colors.indigo[900],
      child: Column(
        children: [
          const Text('Available Balance', style: TextStyle(color: Colors.white70, fontSize: 16)),
          const SizedBox(height: 8),
          Text(formattedBalance, style: const TextStyle(color: Colors.white, fontSize: 40, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Text(formattedUsdc, style: const TextStyle(color: Colors.white54, fontSize: 14)),
        ],
      ),
    );
  }

  Widget _buildContractCard(SmartContractPayment contract) {
    final isSettled = contract.status == 'Settled';
    // Delivery is proven by the geo-fence breach; funds stay releasable until
    // the escrow actually settles. Keying this off `!contract.bolSigned` left a
    // contract whose BOL was signed elsewhere with no badge and no button, so
    // the driver could never trigger a payout that was already earned.
    final canSettle = contract.geoFenceBreached && !isSettled;

    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(contract.brokerName, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                Text('\$${contract.amountUsd.toStringAsFixed(2)}', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: isSettled ? Colors.green : Colors.black)),
              ],
            ),
            const SizedBox(height: 4),
            Text('Load: ${contract.loadId} • Contract: ${contract.contractId}', style: const TextStyle(color: Colors.grey, fontSize: 12)),
            const Divider(height: 32),
            const Text('Smart Contract Conditions:', style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            _buildConditionRow('Destination Geo-fence Breached', contract.geoFenceBreached),
            const SizedBox(height: 4),
            _buildConditionRow('Digital BOL Signed by Receiver', contract.bolSigned),
            const SizedBox(height: 16),
            if (isSettled)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: Colors.green[50], borderRadius: BorderRadius.circular(8)),
                child: const Text('SETTLED', textAlign: TextAlign.center, style: TextStyle(color: Colors.green, fontWeight: FontWeight.bold)),
              )
            else if (canSettle)
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: () => _signBolAndSettle(contract),
                  icon: Icon(contract.bolSigned ? Icons.lock_open : Icons.draw),
                  label: Text(contract.bolSigned
                      ? 'RELEASE FUNDS'
                      : 'SIGN BOL & RELEASE FUNDS'),
                  style: ElevatedButton.styleFrom(backgroundColor: Colors.indigo[900], foregroundColor: Colors.white),
                ),
              )
            else
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: Colors.orange[50], borderRadius: BorderRadius.circular(8)),
                child: Text(contract.status.toUpperCase(), textAlign: TextAlign.center, style: TextStyle(color: Colors.orange[900], fontWeight: FontWeight.bold)),
              )
          ],
        ),
      ),
    );
  }

  Widget _buildConditionRow(String label, bool isMet) {
    return Row(
      children: [
        Icon(isMet ? Icons.check_circle : Icons.radio_button_unchecked, color: isMet ? Colors.green : Colors.grey, size: 20),
        const SizedBox(width: 8),
        Text(label, style: TextStyle(color: isMet ? Colors.black : Colors.grey)),
      ],
    );
  }
}
