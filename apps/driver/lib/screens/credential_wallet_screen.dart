import 'package:flutter/material.dart';
import '../models/credential_wallet_model.dart';
import '../services/did_wallet_service.dart';
import 'package:intl/intl.dart';

class CredentialWalletScreen extends StatefulWidget {
  const CredentialWalletScreen({super.key});

  @override
  State<CredentialWalletScreen> createState() => _CredentialWalletScreenState();
}

class _CredentialWalletScreenState extends State<CredentialWalletScreen> {
  final DidWalletService _walletService = DidWalletService();
  List<DriverCredential> _credentials = [];
  bool _isLoading = true;
  bool _isSharing = false;

  @override
  void initState() {
    super.initState();
    _loadCredentials();
  }

  void _loadCredentials() async {
    final creds = await _walletService.getWalletCredentials();
    if (mounted) {
      setState(() {
        _credentials = creds;
        _isLoading = false;
      });
    }
  }

  void _shareWithBroker() async {
    setState(() => _isSharing = true);
    final success = await _walletService.shareCredentialProof('did:ethr:0xBrokerAccount123');
    if (mounted) {
      setState(() => _isSharing = false);
      if (success) {
        showDialog(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Row(
              children: [
                Icon(Icons.verified_user, color: Colors.green),
                SizedBox(width: 8),
                Text('Proof Shared'),
              ],
            ),
            content: const Text('Cryptographic proof of your CDL, Medical Card, and TWIC has been securely sent to the broker. They cannot see your sensitive PII, only that your credentials are valid.'),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK'))
            ],
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Decentralized ID Wallet'),
        backgroundColor: Colors.deepPurple[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                _buildSecurityHeader(),
                Expanded(
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _credentials.length,
                    itemBuilder: (context, index) {
                      return _buildCredentialCard(_credentials[index]);
                    },
                  ),
                )
              ],
            ),
      floatingActionButton: _isLoading
          ? null
          : FloatingActionButton.extended(
              onPressed: _isSharing ? null : _shareWithBroker,
              backgroundColor: Colors.deepPurple[700],
              icon: _isSharing 
                  ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)) 
                  : const Icon(Icons.share),
              label: Text(_isSharing ? 'GENERATING PROOF...' : 'SHARE PROOF WITH BROKER'),
            ),
    );
  }

  Widget _buildSecurityHeader() {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.deepPurple[800],
        borderRadius: const BorderRadius.only(bottomLeft: Radius.circular(24), bottomRight: Radius.circular(24)),
      ),
      child: const Row(
        children: [
          Icon(Icons.shield, size: 48, color: Colors.white),
          SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Secure Enclave', style: TextStyle(color: Colors.white70, fontSize: 14)),
                SizedBox(height: 4),
                Text('Your documents are stored on-device and cryptographically signed. Brokers verify you without storing your PII.', 
                  style: TextStyle(color: Colors.white, fontSize: 12)),
              ],
            ),
          )
        ],
      ),
    );
  }

  Widget _buildCredentialCard(DriverCredential credential) {
    IconData typeIcon;
    switch (credential.credentialType) {
      case 'CDL': typeIcon = Icons.badge; break;
      case 'Medical': typeIcon = Icons.medical_services; break;
      case 'TWIC': typeIcon = Icons.directions_boat; break;
      default: typeIcon = Icons.description;
    }

    final daysUntilExpiry = credential.expirationDate.difference(DateTime.now()).inDays;
    final isExpiringSoon = daysUntilExpiry < 30;

    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: const BorderRadius.only(topLeft: Radius.circular(16), topRight: Radius.circular(16)),
              border: Border(bottom: BorderSide(color: Colors.grey[200]!)),
            ),
            child: Row(
              children: [
                CircleAvatar(backgroundColor: Colors.deepPurple[50], child: Icon(typeIcon, color: Colors.deepPurple)),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(credential.title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                      Text(credential.issuer, style: const TextStyle(color: Colors.grey, fontSize: 12)),
                    ],
                  ),
                ),
                if (credential.isVerified)
                  const Icon(Icons.verified, color: Colors.green)
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: const BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.only(bottomLeft: Radius.circular(16), bottomRight: Radius.circular(16)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Blockchain Hash', style: TextStyle(color: Colors.grey, fontSize: 10)),
                    Text(credential.cryptographicHash, style: const TextStyle(fontFamily: 'Courier', fontWeight: FontWeight.bold)),
                  ],
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Text('Expires', style: TextStyle(color: Colors.grey, fontSize: 10)),
                    Text(
                      DateFormat('MMM d, yyyy').format(credential.expirationDate), 
                      style: TextStyle(fontWeight: FontWeight.bold, color: isExpiringSoon ? Colors.red : Colors.black87),
                    ),
                  ],
                )
              ],
            ),
          )
        ],
      ),
    );
  }
}
