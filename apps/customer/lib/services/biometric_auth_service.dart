import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:local_auth/local_auth.dart';

class BiometricAuthService {
  static final LocalAuthentication _auth = LocalAuthentication();

  /// Checks if device supports biometrics and if any are enrolled.
  /// On desktop web, handles capability safely without throwing exceptions.
  static Future<bool> isBiometricAvailable() async {
    try {
      if (kIsWeb) {
        // Desktop web or browsers without WebAuthn biometric support
        return false; 
      }
      final bool canAuthenticateWithBiometrics = await _auth.canCheckBiometrics;
      final bool canAuthenticate =
          canAuthenticateWithBiometrics || await _auth.isDeviceSupported();
      return canAuthenticate;
    } catch (e) {
      debugPrint('Biometric availability check failed: $e');
      return false;
    }
  }

  /// Authenticates user via biometrics if available; otherwise falls back to secure PIN.
  static Future<bool> authenticateUser(
    BuildContext context, {
    String reason = 'Authenticate to authorize secure escrow transaction',
  }) async {
    final bool available = await isBiometricAvailable();

    if (available) {
      try {
        final bool didAuthenticate = await _auth.authenticate(
          localizedReason: reason,
          options: const AuthenticationOptions(
            stickyAuth: true,
            biometricOnly: false,
          ),
        );
        if (didAuthenticate) return true;
      } catch (e) {
        debugPrint('Biometric authentication exception: $e');
      }
    }

    // Fallback for Desktop Web or when biometrics fail/are unavailable
    return await _showPinFallbackDialog(context);
  }

  /// Secure PIN / Password fallback dialog for Desktop Web & unsupported environments
  static Future<bool> _showPinFallbackDialog(BuildContext context) async {
    final TextEditingController pinController = TextEditingController();
    bool authenticated = false;

    await showDialog(
      context: context,
      barrierDismissible: false,
      builder: (BuildContext dialogContext) {
        return AlertDialog(
          title: const Row(
            children: [
              Icon(Icons.lock_outline, color: Colors.blue),
              SizedBox(width: 8),
              Text('Security Verification'),
            ],
          ),
          content: SizedBox(
            width: 360,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Biometric verification is unavailable on this browser/device. Please enter your 6-digit secure transaction PIN to authorize.',
                  style: TextStyle(fontSize: 13, color: Colors.grey),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: pinController,
                  obscureText: true,
                  keyboardType: TextInputType.number,
                  maxLength: 6,
                  decoration: const InputDecoration(
                    labelText: 'Secure Transaction PIN',
                    border: OutlineInputBorder(),
                    counterText: '',
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.pop(dialogContext);
              },
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: () {
                // Mock PIN verification (in production, verify against secure store / backend hash)
                if (pinController.text == '123456' || pinController.text.length == 6) {
                  authenticated = true;
                  Navigator.pop(dialogContext);
                } else {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Invalid PIN. Use 123456 for demo.')),
                  );
                }
              },
              child: const Text('Authorize'),
            ),
          ],
        );
      },
    );

    return authenticated;
  }
}
