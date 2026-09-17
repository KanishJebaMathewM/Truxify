import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:local_auth/local_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../data/mock_data.dart';
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

class _LoginScreenState extends State<LoginScreen> {
  final TextEditingController _phoneController = TextEditingController(
    text: mockPhoneNumber.replaceFirst('+91 ', '').replaceAll(' ', ''),
  );
  final List<TextEditingController> _otpControllers =
      List.generate(4, (_) => TextEditingController());
  final List<FocusNode> _otpFocusNodes = List.generate(4, (_) => FocusNode());
  final LocalAuthentication _localAuth = LocalAuthentication();
  bool _showOtp = false;

  @override
  void initState() {
    super.initState();
    _checkExistingSessionAndBiometrics();
    
    for (int i = 0; i < 4; i++) {
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

  Future<void> _checkExistingSessionAndBiometrics() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    final bool hasSession = prefs.getBool('is_authenticated') ?? false;

    if (hasSession) {
      final bool canAuthenticateWithBiometrics = await _localAuth.canCheckBiometrics ||
          await _localAuth.isDeviceSupported();
          if (!mounted) return;
      if (canAuthenticateWithBiometrics) {
        await _authenticateWithBiometrics();
      }
    }
  }

  Future<void> _authenticateWithBiometrics() async {
    try {
      final bool authenticated = await _localAuth.authenticate(
        localizedReason: 'Authenticate to access your freight account',
        options: const AuthenticationOptions(stickyAuth: true, biometricOnly: true),
      );

      if (authenticated) {
        if (!mounted) return;

        final prefs = await SharedPreferences.getInstance();
        await prefs.setBool('is_authenticated', true);
        if (!mounted) return;
        _navigateToShell();
      }
    } catch (_) {
      // Gracefully fall back to standard OTP form if biometrics are cancelled/fail
    }
  }

  void _sendOtp() {
    FocusScope.of(context).unfocus();
    final String? cleanedPhone = _validateAndGetCleanedPhone(_phoneController);
    if (cleanedPhone == null) {
      return;
    }
    handleOtpRequest(_phoneController);
    setState(() => _showOtp = true);
  }

  Future<void> _verifyOtp() async {
    final otp = _otpControllers.map((controller) => controller.text).join();
    if (otp == mockOtp) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool('is_authenticated', true);
      if (!mounted) return;
      if (mounted) {
        _navigateToShell();
      }
      return;
    }

    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Use mock OTP 1234 to continue.')),
    );
  }

  void _navigateToShell() {
    Navigator.of(context).pushReplacement(
      AppPageRoute(builder: (_) => const TruxifyShellScreen()),
    );
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
                'Sign in to manage your freight bookings offline with mock data.',
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
          maxLength: 10,
          keyboardType: TextInputType.phone,
          inputFormatters: [
            FilteringTextInputFormatter.digitsOnly,
          ],
          style: TextStyle(color: colorScheme.onSurface),
          decoration: InputDecoration(
            prefixIcon: Container(
              alignment: Alignment.center,
              width: 70,
              margin: const EdgeInsets.only(right: 8),
              decoration: BoxDecoration(
                border: Border(
                  right: BorderSide(color: borderColor),
                ),
              ),
              child: Text(
                '+91',
                style: TextStyle(
                  color: colorScheme.onSurface,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            hintText: '9876543210',
          ),
        ),
        const SizedBox(height: 18),
        PrimaryButton(label: 'Send OTP', onPressed: _sendOtp),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: _authenticateWithBiometrics,
          icon: const Icon(Icons.fingerprint),
          label: const Text('Login with Biometrics'),
          style: OutlinedButton.styleFrom(
            minimumSize: const Size.fromHeight(48),
          ),
        ),
        const SizedBox(height: 18),
        InfoCard(
          child: Row(
            children: [
              const Icon(Icons.lock_rounded, color: TruxifyColors.accentDark),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  'Mock verification is enabled. Use 1234 on the next screen.',
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
        const SizedBox(height: 12),
        Row(
          children: List.generate(4, (index) {
            return Expanded(
              child: Padding(
                padding: EdgeInsets.only(right: index == 3 ? 0 : 10),
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
                    if (value.isNotEmpty && index < 3) {
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
        PrimaryButton(label: 'Verify OTP', onPressed: _verifyOtp),
        const SizedBox(height: 14),
        TextButton(
          onPressed: () => setState(() => _showOtp = false),
          child: const Text('Change phone number'),
        ),
      ],
    );
  }

  // Validates phone number, manages SnackBar alerts, and extracts clean 10-digit format
  String? _validateAndGetCleanedPhone(TextEditingController controller) {
    String raw = controller.text.trim();
    String cleaned = raw.replaceAll(RegExp(r'\\D'), '');

    if (cleaned.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please enter a phone number'),
          behavior: SnackBarBehavior.floating,
        ),
      );
      return null;
    }

    if (cleaned.length != 10 || !RegExp(r'^[0-9]{10}$').hasMatch(cleaned)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please enter a valid 10-digit phone number'),
          behavior: SnackBarBehavior.floating,
        ),
      );
      return null;
    }

    return cleaned;
  }

  // Primary OTP request trigger bound to UI action
  void handleOtpRequest(TextEditingController controller) {
    final String? cleanedPhone = _validateAndGetCleanedPhone(controller);
    if (cleanedPhone == null) {
      return;
    }
    debugPrint('[LoginScreen] Phone validation passed.');
  }
}