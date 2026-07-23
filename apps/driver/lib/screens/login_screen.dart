import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../core/app_routes.dart';
import '../l10n/app_localizations.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';
import '../widgets/app_logo.dart';
import '../widgets/common_widgets.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

const _countryCodes = [
  ('+1', 'US +1', 10),
  ('+91', 'IN +91', 10),
  ('+44', 'UK +44', 10),
  ('+61', 'AU +61', 9),
  ('+81', 'JP +81', 10),
  ('+86', 'CN +86', 11),
  ('+49', 'DE +49', 10),
  ('+33', 'FR +33', 9),
  ('+55', 'BR +55', 10),
  ('+7', 'RU +7', 10),
];

class _LoginScreenState extends State<LoginScreen> {
  final TextEditingController _phoneController = TextEditingController();
  final AuthService _authService = AuthService();
  bool _loading = false;
  String? _verificationId;
  int? _resendToken;
  String _selectedCode = '+91';
  int _expectedDigits = 10;

  @override
  void dispose() {
    _phoneController.dispose();
    super.dispose();
  }

  void _sendOtp() async {
    final phone = _phoneController.text.replaceAll(' ', '').trim();

    if (phone.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(AppLocalizations.of(context)!.pleaseEnterPhone)),
      );
      return;
    }

    if (int.tryParse(phone) == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(AppLocalizations.of(context)!.enterValidPhone)),
      );
      return;
    }

    if (phone.length != _expectedDigits) {
      final l10n = AppLocalizations.of(context)!;
      final msg = l10n.phoneMustBeExactDigits(_expectedDigits);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(msg)),
      );
      return;
    }

    setState(() => _loading = true);

    try {
      await _authService.verifyPhoneNumber(
        phoneNumber: '$_selectedCode$phone',
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
              'countryCode': _selectedCode,
            },
          );
        },
        onVerificationFailed: (FirebaseAuthException e) {
          if (!mounted) return;
          setState(() => _loading = false);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(e.message ?? AppLocalizations.of(context)!.verificationFailed)),
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
              SnackBar(content: Text(AppLocalizations.of(context)!.autoVerificationFailed)),
            );
          }
        },
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(AppLocalizations.of(context)!.verificationFailed)),
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
                AppLocalizations.of(context)!.welcomeDriver,
                style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                      color: colorScheme.onSurface,
                    ),
              ),
              const SizedBox(height: 8),
              Text(
                AppLocalizations.of(context)!.logInToStartEarning,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: TruxifyColors.adaptiveSecondaryText(context),
                    ),
              ),
              const SizedBox(height: 28),
              Text(
                AppLocalizations.of(context)!.phoneNumber,
                style: Theme.of(context).textTheme.labelLarge?.copyWith(
                      color: TruxifyColors.adaptiveSecondaryText(context),
                    ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _phoneController,
                maxLength: _expectedDigits,
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                ],
                style: TextStyle(color: colorScheme.onSurface),
                keyboardType: TextInputType.phone,
                decoration: InputDecoration(
                  prefixIcon: Container(
                    alignment: Alignment.center,
                    width: 90,
                    margin: const EdgeInsets.only(right: 8),
                    decoration: BoxDecoration(
                      border: Border(
                        right: BorderSide(color: colorScheme.outlineVariant),
                      ),
                    ),
                    child: DropdownButtonHideUnderline(
                      child: DropdownButton<String>(
                        value: _selectedCode,
                        isDense: true,
                        dropdownColor: colorScheme.surface,
                        style: TextStyle(
                          color: colorScheme.onSurface,
                          fontWeight: FontWeight.w700,
                          fontSize: 14,
                        ),
                        items: _countryCodes.map((c) {
                          return DropdownMenuItem(
                            value: c.$1,
                            child: Text(c.$2),
                          );
                        }).toList(),
                        onChanged: (val) {
                          if (val == null) return;
                          final code = _countryCodes.firstWhere((c) => c.$1 == val);
                          setState(() {
                            _selectedCode = val;
                            _expectedDigits = code.$3;
                            _phoneController.clear();
                          });
                        },
                      ),
                    ),
                  ),
                  hintText: '9876543210',
                ),
              ),
              const SizedBox(height: 20),
              PrimaryButton(
                label: _loading ? AppLocalizations.of(context)!.sending : AppLocalizations.of(context)!.sendOtp,
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
                AppLocalizations.of(context)!.protectedDriverAccess,
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
