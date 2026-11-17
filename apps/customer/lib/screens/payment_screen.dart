import 'package:flutter/material.dart';

import 'payment_methods_screen.dart';

export 'payment_methods_screen.dart';

/// Payment screen that intercepts Android hardware back button via [PopScope]
/// to prevent exiting the Truxify customer application prematurely and ensure
/// proper navigator stack popping.
class PaymentScreen extends StatelessWidget {
  const PaymentScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvoked: (didPop) {
        if (!didPop) Navigator.of(context).pop();
      },
      child: const PaymentMethodsScreen(),
    );
  }
}
