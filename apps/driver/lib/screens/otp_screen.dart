import 'dart:async';

import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../core/app_routes.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';
import '../widgets/app_logo.dart';
import '../widgets/common_widgets.dart';

class OtpScreen extends StatefulWidget {
  const OtpScreen({super.key, required this.phone, required this.verificationId});

  final String phone;
  final String verificationId;

  @override
  State<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends State<OtpScreen> {
  late final List<TextEditingController> _controllers =
      List.generate(6, (_) => TextEditingController());
  late final List<FocusNode> _focusNodes = List.generate(6, (_) => FocusNode());
  final AuthService _authService = AuthService();
  bool _loading = false;

  @override
  void dispose() {
    for (final controller in _controllers) {
      controller.dispose();
    }
    for (final node in _focusNodes) {
      node.dispose();
    }
    super.dispose();
  }

  Future<void> _verifyOtp() async {
    if (_loading) return;

    final code =
        _controllers.map((c) => c.text.replaceAll('\u200B', '')).join();
    if (!RegExp(r'^\d{6}$').hasMatch(code)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter a valid 6-digit OTP')),
      );
      return;
    }

    setState(() => _loading = true);
    try {
      await _authService.verifyOtp(widget.verificationId, code);

      if (!mounted) return;

      Navigator.of(context).pushReplacementNamed(AppRoutes.shell);
    } on FirebaseAuthException catch (e) {
      if (!mounted) return;
      String message;
      switch (e.code) {
        case 'invalid-verification-code':
          message = 'Invalid OTP. Please check and try again.';
          break;
        case 'session-expired':
          message = 'Code expired. Please request a new OTP.';
          break;
        default:
          message = e.message ?? 'Verification failed. Please try again.';
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not verify OTP: $e')),
      );
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        backgroundColor: Theme.of(context).scaffoldBackgroundColor,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        foregroundColor: TruxifyColors.primaryText,
        title: Text(
          'Verify OTP',
          style: TextStyle(
            color: colorScheme.onSurface,
          ),
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const TruxifyLogo(size: 28),
              const SizedBox(height: 30),
              Text(
                'Enter the 6-digit OTP',
                style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                      color: colorScheme.onSurface,
                    ),
              ),
              const SizedBox(height: 8),
              Text(
                'Sent to +91 ${widget.phone}',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: TruxifyColors.adaptiveSecondaryText(context),
                    ),
              ),
              const SizedBox(height: 24),
              OtpInputRow(controllers: _controllers, focusNodes: _focusNodes),
              const SizedBox(height: 24),
              PrimaryButton(
                label: _loading ? 'Verifying...' : 'Verify OTP',
                onPressed: _loading ? null : _verifyOtp,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
