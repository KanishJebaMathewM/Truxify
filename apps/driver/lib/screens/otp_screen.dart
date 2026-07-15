import 'dart:async';

import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../core/app_routes.dart';
import '../l10n/app_localizations.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';
import '../widgets/app_logo.dart';
import '../widgets/common_widgets.dart';

class OtpScreen extends StatefulWidget {
  const OtpScreen({
    super.key,
    required this.phone,
    required this.verificationId,
    this.countryCode = '+91',
  });

  final String phone;
  final String verificationId;
  final String countryCode;

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
        SnackBar(content: Text(AppLocalizations.of(context)!.invalidOtp)),
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
      final l10n = AppLocalizations.of(context)!;
      switch (e.code) {
        case 'invalid-verification-code':
          message = l10n.invalidOtp;
          break;
        case 'session-expired':
          message = l10n.codeExpired;
          break;
        default:
          message = e.message ?? l10n.verificationFailedMsg;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(AppLocalizations.of(context)!.couldNotVerifyOtp)),
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
          AppLocalizations.of(context)!.verifyOtp,
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
                AppLocalizations.of(context)!.enterOtp,
                style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                      color: colorScheme.onSurface,
                    ),
              ),
              const SizedBox(height: 8),
              Text(
                AppLocalizations.of(context)!.sentTo('${widget.countryCode} ${widget.phone}'),
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: TruxifyColors.adaptiveSecondaryText(context),
                    ),
              ),
              const SizedBox(height: 24),
              OtpInputRow(controllers: _controllers, focusNodes: _focusNodes),
              const SizedBox(height: 24),
              PrimaryButton(
                label: _loading ? AppLocalizations.of(context)!.verifying : AppLocalizations.of(context)!.verifyOtp,
                onPressed: _loading ? null : _verifyOtp,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
