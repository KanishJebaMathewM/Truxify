const fs = require('fs');

let screenPath = 'apps/customer/lib/screens/login_screen.dart';
let screenCode = fs.readFileSync(screenPath, 'utf8');

// 1. Add import for local_auth
let importRegex = /import 'package:flutter\/material\.dart';/;
let newImport = `import 'package:flutter/material.dart';
import 'package:local_auth/local_auth.dart';`;
screenCode = screenCode.replace(importRegex, newImport);

// 2. Add localAuth instance to state
let stateTopRegex = /final AuthService _authService = AuthService\(\);/;
let newStateTop = `final AuthService _authService = AuthService();
  final LocalAuthentication _localAuth = LocalAuthentication();`;
screenCode = screenCode.replace(stateTopRegex, newStateTop);

// 3. Add biometric authentication method
let methodsRegex = /void _sendOtp\(\) async \{/;
let newMethods = `Future<void> _authenticateWithBiometrics() async {
    try {
      final canCheckBiometrics = await _localAuth.canCheckBiometrics;
      final isDeviceSupported = await _localAuth.isDeviceSupported();
      if (!canCheckBiometrics || !isDeviceSupported) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Biometrics not supported on this device')),
        );
        return;
      }
      
      final authenticated = await _localAuth.authenticate(
        localizedReason: 'Authenticate to log in',
        options: const AuthenticationOptions(
          stickyAuth: true,
          biometricOnly: true,
        ),
      );
      
      if (authenticated) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Biometric authentication successful. Please login with OTP to link your account.'),
            duration: Duration(seconds: 4),
          ),
        );
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Biometric error: $e')),
      );
    }
  }

  void _sendOtp() async {`;
screenCode = screenCode.replace(methodsRegex, newMethods);

// 4. Add Biometric button to the UI in `_buildPhoneForm`
let phoneFormEndRegex = /const SizedBox\(height: 18\),\s*InfoCard\(/;
let newPhoneFormEnd = `const SizedBox(height: 18),
        Center(
          child: TextButton.icon(
            onPressed: _authenticateWithBiometrics,
            icon: const Icon(Icons.fingerprint, size: 28),
            label: const Text('Login with Biometrics'),
            style: TextButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
            ),
          ),
        ),
        const SizedBox(height: 18),
        InfoCard(`;
screenCode = screenCode.replace(phoneFormEndRegex, newPhoneFormEnd);

fs.writeFileSync(screenPath, screenCode);
console.log("Refactored successfully.");
