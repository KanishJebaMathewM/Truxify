import 'package:flutter/material.dart';
import '../models/biometric_auth_model.dart';
import '../services/biometric_security_service.dart';

class HighValueFreightSecurityScreen extends StatefulWidget {
  final String loadId;
  const HighValueFreightSecurityScreen({super.key, this.loadId = 'LD-SECPHARM-991'});

  @override
  State<HighValueFreightSecurityScreen> createState() => _HighValueFreightSecurityScreenState();
}

class _HighValueFreightSecurityScreenState extends State<HighValueFreightSecurityScreen> {
  final BiometricSecurityService _securityService = BiometricSecurityService();
  HighValueFreightSecurity? _securityData;
  bool _isLoading = true;
  bool _isAuthenticating = false;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  void _loadData() async {
    final data = await _securityService.getLoadSecurityStatus(widget.loadId);
    if (mounted) {
      setState(() {
        _securityData = data;
        _isLoading = false;
      });
    }
  }

  void _unlockTrailer() async {
    setState(() {
      _isAuthenticating = true;
    });

    // In a real app, this would trigger local_auth package (FaceID/TouchID)
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        backgroundColor: Colors.black87,
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.face, size: 64, color: Colors.blueAccent),
            const SizedBox(height: 16),
            const Text('Verifying Biometrics...', style: TextStyle(color: Colors.white, fontSize: 18)),
            const SizedBox(height: 8),
            Text('FaceID for Truxify Security', style: TextStyle(color: Colors.grey[400])),
          ],
        ),
      )
    );

    final success = await _securityService.authenticateAndUnlockSeal(_securityData!.iotSealMacAddress, 'FACE_ID');

    if (mounted && success) {
      Navigator.pop(context); // Close biometric dialog
      setState(() {
        _securityData = HighValueFreightSecurity(
          loadId: _securityData!.loadId,
          freightType: _securityData!.freightType,
          isIoTSealLocked: false,
          iotSealMacAddress: _securityData!.iotSealMacAddress,
          requiredAuthenticationLevel: _securityData!.requiredAuthenticationLevel,
        );
        _isAuthenticating = false;
      });

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Trailer Unlocked Successfully. Bluetooth seal disengaged.'),
          backgroundColor: Colors.green,
        )
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('High-Value Security Center'),
        backgroundColor: Colors.black,
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _buildSecurityDashboard(),
    );
  }

  Widget _buildSecurityDashboard() {
    final bool isLocked = _securityData!.isIoTSealLocked;

    return Column(
      children: [
        Container(
          width: double.infinity,
          color: isLocked ? Colors.red[900] : Colors.green[800],
          padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 24),
          child: Column(
            children: [
              Icon(isLocked ? Icons.lock : Icons.lock_open, size: 80, color: Colors.white),
              const SizedBox(height: 16),
              Text(
                isLocked ? 'IOT TRAILER SEAL ENGAGED' : 'TRAILER UNLOCKED',
                style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold, letterSpacing: 1.2),
              ),
              const SizedBox(height: 8),
              Text(
                isLocked ? 'Secure Load: ${_securityData!.freightType}' : 'Doors are now accessible for unloading',
                style: const TextStyle(color: Colors.white70, fontSize: 16),
                textAlign: TextAlign.center,
              )
            ],
          ),
        ),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Security Requirements', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.grey)),
                const SizedBox(height: 16),
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.security, color: Colors.blueAccent),
                    title: const Text('Authentication Level 3'),
                    subtitle: const Text('Biometric verification (Face/Fingerprint) required to disengage seal via Bluetooth.'),
                  ),
                ),
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.bluetooth, color: Colors.blueAccent),
                    title: const Text('IoT Seal Connection'),
                    subtitle: Text('MAC: ${_securityData!.iotSealMacAddress}'),
                    trailing: const Icon(Icons.check_circle, color: Colors.green),
                  ),
                ),
                const Spacer(),
                if (isLocked)
                  SizedBox(
                    width: double.infinity,
                    height: 56,
                    child: ElevatedButton.icon(
                      onPressed: _isAuthenticating ? null : _unlockTrailer,
                      icon: const Icon(Icons.fingerprint),
                      label: const Text('VERIFY IDENTITY TO UNLOCK', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.black,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))
                      ),
                    ),
                  )
              ],
            ),
          ),
        )
      ],
    );
  }
}
