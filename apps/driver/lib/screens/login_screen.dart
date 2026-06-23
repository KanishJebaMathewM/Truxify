import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../core/app_routes.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';
import '../widgets/app_logo.dart';
import '../widgets/common_widgets.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final TextEditingController _phoneController = TextEditingController();
  final AuthService _authService = AuthService();
  bool _loading = false;
  String? _verificationId;
  int? _resendToken;

  @override
  void dispose() {
    _phoneController.dispose();
    super.dispose();
  }

  void _sendOtp() async {
    final phone = _phoneController.text.replaceAll(' ', '').trim();

    if (phone.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter phone number')),
      );
      return;
    }

    if (phone.length != 10 || int.tryParse(phone) == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter a valid 10-digit phone number')),
      );
      return;
    }

    setState(() => _loading = true);

    try {
      await _authService.verifyPhoneNumber(
        phoneNumber: '+91$phone',
        forceResendingToken: _resendToken,
        onCodeSent: (verificationId, resendToken) {
          if (!mounted) return;
          setState(() {
            _loading = false;
            _verificationId = verificationId;
            _resendToken = resendToken;
          });
          Navigator.of(context).pushNamed(
            AppRoutes.otp,
            arguments: <String, String>{
              'phone': phone,
              'verificationId': verificationId,
            },
          );
        },
        onVerificationFailed: (FirebaseAuthException e) {
          if (!mounted) return;
          setState(() => _loading = false);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(e.message ?? 'Verification failed')),
          );
        },
        onAutoVerification: (PhoneAuthCredential credential) async {
          if (!mounted) return;
          try {
            await FirebaseAuth.instance.signInWithCredential(credential);
            if (!mounted) return;
            Navigator.of(context).pushReplacementNamed(AppRoutes.shell);
          } catch (e) {
            if (!mounted) return;
            setState(() => _loading = false);
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text('Auto-verification failed: $e')),
            );
          }
        },
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Verification failed: $e')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 28, 24, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const TruxifyLogo(size: 30),
              const SizedBox(height: 36),
              Text(
                'Welcome, Driver',
                style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                      color: colorScheme.onSurface,
                    ),
              ),
              const SizedBox(height: 8),
              Text(
                'Log in to start earning',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: TruxifyColors.adaptiveSecondaryText(context),
                    ),
              ),
              const SizedBox(height: 28),
              Text(
                'Phone Number',
                style: Theme.of(context).textTheme.labelLarge?.copyWith(
                      color: TruxifyColors.adaptiveSecondaryText(context),
                    ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _phoneController,
                maxLength: 10,
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                ],
                style: TextStyle(color: colorScheme.onSurface),
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(
                  prefixText: '+91  ',
                  hintText: '9876543210',
                ),
              ),
              const SizedBox(height: 20),
              PrimaryButton(
                label: _loading ? 'Sending...' : 'Send OTP',
                onPressed: _loading ? null : _sendOtp,
              ),
              const SizedBox(height: 18),
              AppCard(
                padding: const EdgeInsets.all(18),
                child: Row(
                  children: [
                    const Icon(Icons.shield_outlined,
                        color: TruxifyColors.accent),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        'A verification code will be sent via SMS to verify your phone number.',
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              color: colorScheme.onSurface,
                            ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 18),
              Text(
                'Protected driver access. Verified via Firebase.',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: TruxifyColors.adaptiveSecondaryText(context),
                    ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
