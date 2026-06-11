import 'package:flutter/material.dart';

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
  late final List<TextEditingController> _controllers =
      List.generate(4, (_) => TextEditingController());
  late final List<FocusNode> _focusNodes = List.generate(4, (_) => FocusNode());

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
    final code =
        _controllers.map((c) => c.text.replaceAll('\u200B', '')).join();
    if (!RegExp(r'^\d{4}$').hasMatch(code)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter a valid 4-digit OTP')),
      );
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text(
            'OTP verification is not available yet. Please try again later.'),
      ),
    );
    // TODO: Integrate backend OTP verification and navigate only after a successful response.
    // TODO: After implimenting the backend otp logic then remove the push named.
    Navigator.of(context).pushNamed(
      AppRoutes.shell,
    );
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
                label: 'Verify OTP',
                onPressed: _verifyOtp,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
