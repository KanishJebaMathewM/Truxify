import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/auth_service.dart';
import '../theme/app_theme.dart';
import '../widgets/app_logo.dart';
import '../widgets/app_page_route.dart';
import '../widgets/common_widgets.dart';
import 'shell_screen.dart';

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
  final AuthService _authService = AuthService();
  final TextEditingController _phoneController = TextEditingController();
  final List<TextEditingController> _otpControllers =
      List.generate(6, (_) => TextEditingController());
  final List<FocusNode> _otpFocusNodes = List.generate(6, (_) => FocusNode());

  bool _showOtp = false;
  bool _sendingOtp = false;
  bool _verifyingOtp = false;
  String? _verificationId;
  int? _resendToken;
  String _selectedCode = '+91';
  int _expectedDigits = 10;

  @override
  void dispose() {
    _phoneController.dispose();
    for (final controller in _otpControllers) {
      controller.dispose();
    }
    for (final node in _otpFocusNodes) {
      node.dispose();
    }
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    for (int i = 0; i < 6; i++) {
      final index = i;
      _otpFocusNodes[index].onKeyEvent = (node, event) {
        if (event is KeyDownEvent &&
            event.logicalKey == LogicalKeyboardKey.backspace &&
            _otpControllers[index].text.isEmpty &&
            index > 0) {
          _otpFocusNodes[index - 1].requestFocus();
          _otpControllers[index - 1].clear();
          return KeyEventResult.handled;
        }
        return KeyEventResult.ignored;
      };
    }
  }

  void _sendOtp() async {
    FocusScope.of(context).unfocus();
    final phone = _phoneController.text.replaceAll(' ', '').trim();

    if (phone.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter phone number')),
      );
      return;
    }

    if (int.tryParse(phone) == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Phone number can only contain digits'),
        ),
      );
      return;
    }

    if (phone.length != _expectedDigits) {
      final msg = _expectedDigits == 10
          ? 'Phone number must be exactly $_expectedDigits digits for $_selectedCode'
          : 'Phone number must be $_expectedDigits digits for $_selectedCode';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(msg)),
      );
      return;
    }

    setState(() => _sendingOtp = true);

    try {
      await _authService.verifyPhoneNumber(
        phoneNumber: '$_selectedCode$phone',
        forceResendingToken: _resendToken,
        onCodeSent: (verificationId, resendToken) {
          if (!mounted) return;
          setState(() {
            _verificationId = verificationId;
            _resendToken = resendToken;
            _showOtp = true;
            _sendingOtp = false;
          });
        },
        onVerificationFailed: (e) {
          if (!mounted) return;
          setState(() => _sendingOtp = false);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                e.message ?? 'Phone verification failed. Please try again.',
              ),
            ),
          );
        },
        onAutoVerification: (credential) async {
          // Auto-verification (e.g. on Android with SMS auto-retrieval)
          if (!mounted) return;
          try {
            await FirebaseAuth.instance.signInWithCredential(credential);
            if (!mounted) return;
            Navigator.of(context).pushReplacement(
                AppPageRoute(builder: (_) => const TruxifyShellScreen()));
          } catch (e) {
            if (!mounted) return;
            setState(() => _sendingOtp = false);
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text('Auto-verification failed: $e')),
            );
          }
        },
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _sendingOtp = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to send OTP: $e')),
      );
    }
  }

  void _verifyOtp() async {
    final otp = _otpControllers.map((controller) => controller.text).join();

    if (otp.length != 6 || !RegExp(r'^\d{6}$').hasMatch(otp)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter a valid 6-digit OTP')),
      );
      return;
    }

    if (_verificationId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Verification session expired. Please resend OTP.'),
        ),
      );
      return;
    }

    setState(() => _verifyingOtp = true);

    try {
      await _authService.verifyOtp(_verificationId!, otp);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
          AppPageRoute(builder: (_) => const TruxifyShellScreen()));
    } on FirebaseAuthException catch (e) {
      if (!mounted) return;
      setState(() => _verifyingOtp = false);
      final message = switch (e.code) {
        'invalid-verification-code' => 'Invalid OTP. Please try again.',
        'session-expired' => 'OTP has expired. Please request a new one.',
        _ => e.message ?? 'Verification failed. Please try again.',
      };
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _verifyingOtp = false);
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
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 22),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 12),
              const AppLogo(iconSize: 24),
              const SizedBox(height: 28),
              Text(
                'Welcome back',
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      color: colorScheme.onSurface,
                      fontWeight: FontWeight.w800,
                    ),
              ),
              const SizedBox(height: 6),
              Text(
                'Sign in to manage your freight bookings.',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: TruxifyColors.adaptiveSecondaryText(context),
                    ),
              ),
              const SizedBox(height: 28),
              AnimatedSwitcher(
                duration: const Duration(milliseconds: 240),
                child: _showOtp
                    ? _buildOtpForm(context)
                    : _buildPhoneForm(context),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildPhoneForm(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final borderColor = Theme.of(context).brightness == Brightness.dark
        ? TruxifyColors.darkBorder
        : TruxifyColors.border;

    return Column(
      key: const ValueKey('phone'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Phone number',
          style: Theme.of(context).textTheme.titleSmall?.copyWith(
                color: colorScheme.onSurface,
                fontWeight: FontWeight.w800,
              ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _phoneController,
          maxLength: _expectedDigits,
          keyboardType: TextInputType.phone,
          inputFormatters: [
            FilteringTextInputFormatter.digitsOnly,
          ],
          style: TextStyle(color: colorScheme.onSurface),
          decoration: InputDecoration(
            prefixIcon: Container(
              alignment: Alignment.center,
              width: 90,
              margin: const EdgeInsets.only(right: 8),
              decoration: BoxDecoration(
                border: Border(
                  right: BorderSide(color: borderColor),
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
        const SizedBox(height: 18),
        PrimaryButton(
          label: _sendingOtp ? 'Sending OTP...' : 'Send OTP',
          onPressed: _sendingOtp ? null : _sendOtp,
        ),
        const SizedBox(height: 18),
        InfoCard(
          child: Row(
            children: [
              const Icon(Icons.lock_rounded, color: TruxifyColors.accentDark),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  'A verification code will be sent via SMS to verify your phone number.',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: TruxifyColors.adaptiveSecondaryText(context),
                      ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildOtpForm(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Column(
      key: const ValueKey('otp'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Enter OTP',
          style: Theme.of(context).textTheme.titleSmall?.copyWith(
                color: colorScheme.onSurface,
                fontWeight: FontWeight.w800,
              ),
        ),
        const SizedBox(height: 4),
        Text(
          'Sent to +91 ${_phoneController.text}',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: TruxifyColors.adaptiveSecondaryText(context),
              ),
        ),
        const SizedBox(height: 12),
        Row(
          children: List.generate(6, (index) {
            return Expanded(
              child: Padding(
                padding: EdgeInsets.only(right: index == 5 ? 0 : 8),
                child: TextField(
                  controller: _otpControllers[index],
                  focusNode: _otpFocusNodes[index],
                  keyboardType: TextInputType.number,
                  textAlign: TextAlign.center,
                  maxLength: 1,
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        color: colorScheme.onSurface,
                        fontWeight: FontWeight.w800,
                      ),
                  decoration: const InputDecoration(counterText: ''),
                  onChanged: (value) {
                    if (value.isNotEmpty && index < 5) {
                      _otpFocusNodes[index + 1].requestFocus();
                    }
                    if (value.isEmpty && index > 0) {
                      _otpFocusNodes[index - 1].requestFocus();
                    }
                  },
                ),
              ),
            );
          }),
        ),
        const SizedBox(height: 18),
        PrimaryButton(
          label: _verifyingOtp ? 'Verifying...' : 'Verify OTP',
          onPressed: _verifyingOtp ? null : _verifyOtp,
        ),
        const SizedBox(height: 14),
        Row(
          children: [
            TextButton(
              onPressed: () {
                for (final c in _otpControllers) {
                  c.clear();
                }
                setState(() => _showOtp = false);
              },
              child: const Text('Change phone number'),
            ),
            const Spacer(),
            TextButton(
              onPressed: _sendingOtp ? null : _sendOtp,
              child: Text(_sendingOtp ? 'Sending...' : 'Resend OTP'),
            ),
          ],
        ),
      ],
    );
  }
}
