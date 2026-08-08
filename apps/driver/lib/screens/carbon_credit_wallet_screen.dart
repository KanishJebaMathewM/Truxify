import 'package:flutter/material.dart';
import '../models/carbon_token_model.dart';
import '../services/carbon_minting_service.dart';

class CarbonCreditWalletScreen extends StatefulWidget {
  const CarbonCreditWalletScreen({super.key});

  @override
  State<CarbonCreditWalletScreen> createState() => _CarbonCreditWalletScreenState();
}

class _CarbonCreditWalletScreenState extends State<CarbonCreditWalletScreen> {
  final CarbonMintingService _service = CarbonMintingService();
  CarbonWalletState? _walletState;
  CarbonMintSession? _currentSession;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadWallet();
  }

  void _loadWallet() async {
    final state = await _service.getWalletState();
    if (mounted) {
      setState(() {
        _walletState = state;
        _isLoading = false;
      });
    }
  }

  void _startMintingProcess() {
    _service.processTripEmissions('TRIP-LAX-SFO-092').listen((session) {
      if (mounted) {
        setState(() {
          _currentSession = session;
          if (session.status == 'Minted Successfully') {
             // Update wallet balance mock
             _walletState = CarbonWalletState(
                walletAddress: _walletState!.walletAddress,
                totalTokensBalance: _walletState!.totalTokensBalance + session.tokensMinted,
                marketPricePerTokenUsd: _walletState!.marketPricePerTokenUsd
             );
          }
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Carbon Credit Tokenizer'),
        backgroundColor: Colors.green[800],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  _buildWalletCard(),
                  const SizedBox(height: 24),
                  if (_currentSession == null)
                    _buildMintButton()
                  else
                    _buildMintingProgress(),
                ],
              ),
            ),
    );
  }

  Widget _buildWalletCard() {
    final w = _walletState!;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        gradient: LinearGradient(colors: [Colors.green[900]!, Colors.teal[800]!]),
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 10)]
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
               Icon(Icons.account_balance_wallet, color: Colors.white70),
               SizedBox(width: 8),
               Text('TRUXIFY GREEN WALLET', style: TextStyle(color: Colors.white70, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
            ],
          ),
          const SizedBox(height: 16),
          Text('${w.totalTokensBalance.toInt()} CRBN', style: const TextStyle(fontSize: 40, fontWeight: FontWeight.bold, color: Colors.white)),
          Text('≈ \$${w.totalValueUsd.toStringAsFixed(2)} USD', style: const TextStyle(fontSize: 16, color: Colors.greenAccent)),
          const Divider(color: Colors.white30, height: 32),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Address: ${w.walletAddress}', style: const TextStyle(color: Colors.white54, fontFamily: 'monospace')),
              const Icon(Icons.qr_code, color: Colors.white54),
            ],
          )
        ],
      ),
    );
  }

  Widget _buildMintButton() {
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          children: [
            Icon(Icons.eco, size: 60, color: Colors.green[700]),
            const SizedBox(height: 16),
            const Text('Trip Completed: LAX to SFO', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            const Text('Zero-emission EV transport detected. Ready to process telematics and mint carbon credits.', textAlign: TextAlign.center, style: TextStyle(color: Colors.grey)),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              height: 50,
              child: ElevatedButton.icon(
                onPressed: _startMintingProcess,
                icon: const Icon(Icons.token),
                label: const Text('MINT SAVINGS TO CHAIN', style: TextStyle(fontWeight: FontWeight.bold)),
                style: ElevatedButton.styleFrom(backgroundColor: Colors.green[800], foregroundColor: Colors.white),
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildMintingProgress() {
    final s = _currentSession!;
    final isDone = s.status == 'Minted Successfully';
    
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: BorderSide(color: isDone ? Colors.green : Colors.transparent, width: 2)),
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Minting Session', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
                if (!isDone) const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                else const Icon(Icons.check_circle, color: Colors.green),
              ],
            ),
            const SizedBox(height: 16),
            Text(s.status, style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: isDone ? Colors.green[800] : Colors.black)),
            const Divider(height: 32),
            _buildStatRow('Baseline Emissions', '${s.baselineEmissionsKg} kg CO2'),
            const SizedBox(height: 8),
            _buildStatRow('Actual EV Emissions', '${s.actualEmissionsKg} kg CO2', color: Colors.green),
            const Divider(height: 32),
            _buildStatRow('Tokens Minted', '+${s.tokensMinted.toInt()} CRBN', isBold: true, color: Colors.blue[800]),
            const SizedBox(height: 16),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: Colors.grey[100], borderRadius: BorderRadius.circular(8)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('TxHash', style: TextStyle(color: Colors.grey, fontSize: 10)),
                  Text(s.blockchainTxHash, style: TextStyle(fontFamily: 'monospace', color: Colors.grey[800])),
                ],
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildStatRow(String label, String value, {bool isBold = false, Color? color}) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: const TextStyle(color: Colors.grey)),
        Text(value, style: TextStyle(fontWeight: isBold ? FontWeight.bold : FontWeight.normal, color: color ?? Colors.black, fontSize: isBold ? 18 : 14)),
      ],
    );
  }
}
