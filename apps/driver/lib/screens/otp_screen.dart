import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../core/app_routes.dart';
import '../theme/app_theme.dart';
import '../widgets/app_logo.dart';
import '../widgets/common_widgets.dart';

class OtpScreen extends StatefulWidget {
  const OtpScreen({super.key, required this.phone});

  final String phone;

  @override
  State<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends State<OtpScreen> {
  static const String _apiBaseUrl = String.fromEnvironment(
    'TRUXIFY_API_BASE_URL',
    defaultValue: 'http://localhost:5000',
  );

  late final List<TextEditingController> _controllers =
      List.generate(4, (_) => TextEditingController());
  late final List<FocusNode> _focusNodes = List.generate(4, (_) => FocusNode());
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
    if (!RegExp(r'^\d{4}$').hasMatch(code)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter a valid 4-digit OTP')),
      );
      return;
    }

    setState(() => _loading = true);
    try {
      final uri = Uri.parse('$_apiBaseUrl/api/driver/otp/verify');
      final response = await http.post(
        uri,
        headers: const {'Content-Type': 'application/json'},
        body: jsonEncode(<String, String>{
          'phone': widget.phone,
          'otp': code,
        }),
      ).timeout(const Duration(seconds: 15));

      if (!mounted) return;

      final success = response.statusCode >= 200 && response.statusCode < 300;
      if (!success) {
        final message = response.body.isNotEmpty
            ? _extractErrorMessage(response.body)
            : 'OTP verification failed.';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(message)),
        );
        return;
      }

      Navigator.of(context).pushReplacementNamed(AppRoutes.shell);
    } on TimeoutException {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Verification timed out. Please check your connection and try again.',
          ),
        ),
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

  String _extractErrorMessage(String body) {
    try {
      final decoded = jsonDecode(body);
      if (decoded is Map<String, dynamic>) {
        final error = decoded['error']?.toString();
        if (error != null && error.isNotEmpty) {
          return error;
        }
      }
    } catch (_) {
      // Fall through to generic error message.
    }
    return 'OTP verification failed.';
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
                'Enter the 4-digit OTP',
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
