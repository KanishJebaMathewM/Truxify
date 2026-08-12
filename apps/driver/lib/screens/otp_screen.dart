import 'dart:async';

import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../core/app_routes.dart';
import '../l10n/app_localizations.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';
import '../widgets/app_logo.dart';
import '../widgets/common_widgets.dart';

/// How long the "Resend OTP" button stays disabled after sending a code (seconds).
const int _kResendCooldownSeconds = 30;

class OtpScreen extends StatefulWidget {
  const OtpScreen({
    super.key,
    required this.phone,
    required this.verificationId,
    this.countryCode = '+91',
    this.resendToken,
  });

  final String phone;
  final String verificationId;
  final String countryCode;

  /// Firebase resend token returned by the initial [verifyPhoneNumber] call.
  /// Passing it back on resend avoids re-sending a fresh SMS unnecessarily.
  final int? resendToken;

  @override
  State<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends State<OtpScreen> {
  late final List<TextEditingController> _controllers =
      List.generate(6, (_) => TextEditingController());
  late final List<FocusNode> _focusNodes = List.generate(6, (_) => FocusNode());

  final AuthService _authService = AuthService();

  /// Mutable verification ID — updated when the user successfully resends.
  late String _verificationId = widget.verificationId;

  /// Mutable resend token — updated after each successful resend call.
  int? _resendToken = widget.resendToken;

  bool _loading = false;
  bool _resending = false;

  // ── Cooldown timer ────────────────────────────────────────────────────────

  /// Seconds remaining in the current cooldown window.
  int _cooldownSeconds = _kResendCooldownSeconds;
  Timer? _cooldownTimer;

  bool get _canResend => _cooldownSeconds == 0 && !_resending;

  @override
  void initState() {
    super.initState();
    _startCooldown();
  }

  @override
  void dispose() {
    _cooldownTimer?.cancel();
    for (final c in _controllers) c.dispose();
    for (final n in _focusNodes) n.dispose();
    super.dispose();
  }

  void _startCooldown() {
    _cooldownTimer?.cancel();
    setState(() => _cooldownSeconds = _kResendCooldownSeconds);

    _cooldownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      setState(() {
        if (_cooldownSeconds > 0) {
          _cooldownSeconds--;
        } else {
          timer.cancel();
        }
      });
    });
  }

  // ── Resend OTP ────────────────────────────────────────────────────────────

  Future<void> _resendOtp() async {
    if (!_canResend) return;

    setState(() => _resending = true);

    try {
      await _authService.verifyPhoneNumber(
        phoneNumber: '${widget.countryCode}${widget.phone}',
        forceResendingToken: _resendToken,
        onCodeSent: (String newVerificationId, int? newResendToken) {
          if (!mounted) return;
          setState(() {
            _verificationId = newVerificationId;
            _resendToken = newResendToken;
          });
          _startCooldown();
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(AppLocalizations.of(context)!.otpResent),
              backgroundColor: TruxifyColors.success,
            ),
          );
          // Clear existing OTP inputs so the user enters the new code.
          for (final c in _controllers) c.clear();
          if (_focusNodes.isNotEmpty) {
            _focusNodes.first.requestFocus();
          }
        },
        onVerificationFailed: (FirebaseAuthException e) {
          if (!mounted) return;
          final msg = e.message ?? AppLocalizations.of(context)!.verificationFailedMsg;
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(msg)),
          );
        },
        onAutoVerification: (PhoneAuthCredential credential) {
          // Auto-verification is handled by Firebase; navigate on success.
          if (!mounted) return;
          Navigator.of(context).pushReplacementNamed(AppRoutes.shell);
        },
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(AppLocalizations.of(context)!.verificationFailedMsg)),
      );
    } finally {
      if (mounted) setState(() => _resending = false);
    }
  }

  // ── Verify OTP ────────────────────────────────────────────────────────────

  Future<void> _verifyOtp() async {
    if (_loading) return;

    final code =
        _controllers.map((c) => c.text.replaceAll('​', '')).join();

    if (!RegExp(r'^\d{6}$').hasMatch(code)) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(AppLocalizations.of(context)!.invalidOtp)),
      );
      return;
    }

    setState(() => _loading = true);
    try {
      await _authService.verifyOtp(_verificationId, code);
      if (!mounted) return;
      Navigator.of(context).pushReplacementNamed(AppRoutes.shell);
    } on FirebaseAuthException catch (e) {
      if (!mounted) return;
      final l10n = AppLocalizations.of(context)!;
      final String message;
      switch (e.code) {
        case 'invalid-verification-code':
          message = l10n.invalidOtp;
          break;
        case 'session-expired':
          message = l10n.codeExpired;
          break;
        case 'network-request-failed':
          message = l10n.networkError;
          break;
        default:
          message = e.message ?? l10n.verificationFailedMsg;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    } catch (e) {
      if (!mounted) return;
      final errorMsg = (e.toString().contains('SocketException') ||
              e.toString().contains('network-request-failed'))
          ? AppLocalizations.of(context)!.networkError
          : AppLocalizations.of(context)!.couldNotVerifyOtp;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(errorMsg)),
      );
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final l10n = AppLocalizations.of(context)!;

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        backgroundColor: Theme.of(context).scaffoldBackgroundColor,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        foregroundColor: TruxifyColors.primaryText,
        title: Text(
          l10n.verifyOtp,
          style: TextStyle(color: colorScheme.onSurface),
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
                l10n.enterOtp,
                style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                      color: colorScheme.onSurface,
                    ),
              ),
              const SizedBox(height: 8),
              Text(
                l10n.sentTo('${widget.countryCode} ${widget.phone}'),
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: TruxifyColors.adaptiveSecondaryText(context),
                    ),
              ),
              const SizedBox(height: 24),
              OtpInputRow(
                  controllers: _controllers, focusNodes: _focusNodes),
              const SizedBox(height: 24),
              PrimaryButton(
                label: _loading ? l10n.verifying : l10n.verifyOtp,
                onPressed: _loading ? null : _verifyOtp,
              ),
              const SizedBox(height: 20),

              // ── Resend row ──────────────────────────────────────────────
              Center(
                child: _resending
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : _cooldownSeconds > 0
                        ? Text(
                            l10n.resendOtpIn(_cooldownSeconds),
                            style:
                                Theme.of(context).textTheme.bodyMedium?.copyWith(
                                      color: TruxifyColors.adaptiveSecondaryText(
                                          context),
                                    ),
                          )
                        : TextButton(
                            onPressed: _resendOtp,
                            child: Text(
                              l10n.resendOtp,
                              style: TextStyle(
                                color: TruxifyColors.accent,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
