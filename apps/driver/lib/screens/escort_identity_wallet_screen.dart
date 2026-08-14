import 'package:flutter/material.dart';
import '../models/escort_identity_wallet_model.dart';
import '../services/escort_identity_wallet_service.dart';

class EscortIdentityWalletScreen extends StatefulWidget {
  const EscortIdentityWalletScreen({super.key});

  @override
  State<EscortIdentityWalletScreen> createState() => _EscortIdentityWalletScreenState();
}

class _EscortIdentityWalletScreenState extends State<EscortIdentityWalletScreen> {
  final EscortIdentityWalletService _service = EscortIdentityWalletService();
  List<EscortConvoyMember>? _convoy;
  bool _isHandshaking = false;

  void _runHandshake() async {
    setState(() => _isHandshaking = true);
    
    final result = await _service.initiateConvoyHandshake();
    
    if (mounted) {
      setState(() {
        _convoy = result;
        _isHandshaking = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Convoy Sovereign Wallet'),
        backgroundColor: Colors.indigo[900],
      ),
      backgroundColor: Colors.grey[100],
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_isHandshaking) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const CircularProgressIndicator(color: Colors.indigo),
            const SizedBox(height: 24),
            Text('Pinging Convoy Wallets...', style: TextStyle(color: Colors.indigo[900], fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            const Text('Verifying cryptographic credential signatures.', style: TextStyle(color: Colors.grey)),
          ],
        ),
      );
    }

    if (_convoy == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.shield, size: 100, color: Colors.indigo[200]),
              const SizedBox(height: 24),
              const Text('Oversize Convoy Assembly', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              const Text('Initiate a digital handshake to instantly verify the sovereign credentials of all escort vehicles in your convoy.', textAlign: TextAlign.center, style: TextStyle(color: Colors.grey)),
              const SizedBox(height: 32),
              SizedBox(
                width: double.infinity,
                height: 56,
                child: ElevatedButton.icon(
                  onPressed: _runHandshake,
                  icon: const Icon(Icons.compare_arrows),
                  label: const Text('INITIATE CONVOY HANDSHAKE'),
                  style: ElevatedButton.styleFrom(backgroundColor: Colors.indigo[800], foregroundColor: Colors.white),
                ),
              )
            ],
          ),
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _buildConvoySummary(),
        const SizedBox(height: 24),
        const Text('VERIFIED ESCORT CONVOY', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
        const SizedBox(height: 8),
        ..._convoy!.map((member) => _buildMemberCard(member)),
      ],
    );
  }

  Widget _buildConvoySummary() {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const Icon(Icons.verified_user, color: Colors.green, size: 48),
            const SizedBox(height: 16),
            const Text('CONVOY CLEARED', style: TextStyle(color: Colors.green, fontSize: 24, fontWeight: FontWeight.bold, letterSpacing: 2)),
            const SizedBox(height: 8),
            Text('${_convoy!.length} escort vehicles mathematically verified for DOT compliance.', textAlign: TextAlign.center, style: const TextStyle(color: Colors.grey)),
          ],
        ),
      ),
    );
  }

  Widget _buildMemberCard(EscortConvoyMember m) {
    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: BorderSide(color: Colors.indigo[100]!)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Icon(Icons.directions_car, color: Colors.indigo[900]),
                    const SizedBox(width: 8),
                    Text(m.driverName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  decoration: BoxDecoration(color: Colors.indigo[50], borderRadius: BorderRadius.circular(12)),
                  child: Text(m.role, style: TextStyle(color: Colors.indigo[900], fontWeight: FontWeight.bold, fontSize: 12)),
                )
              ],
            ),
            const SizedBox(height: 8),
            Text('Vehicle ID: ${m.vehicleId}', style: const TextStyle(color: Colors.grey)),
            Text('DID: ${m.did}', style: const TextStyle(color: Colors.grey, fontSize: 10, fontFamily: 'monospace')),
            const Divider(height: 24),
            const Text('VERIFIED CREDENTIALS', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
            const SizedBox(height: 8),
            ...m.credentials.map((c) => _buildCredentialItem(c)),
          ],
        ),
      ),
    );
  }

  Widget _buildCredentialItem(EscortCredential c) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.check_circle, color: Colors.green, size: 16),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(c.documentType, style: const TextStyle(fontWeight: FontWeight.bold)),
                Text('Issued by: ${c.issuer} | Exp: ${c.expirationDate}', style: const TextStyle(color: Colors.grey, fontSize: 12)),
              ],
            ),
          )
        ],
      ),
    );
  }
}
