import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';

class PaymentMethodsScreen extends StatefulWidget {
  const PaymentMethodsScreen({super.key});

  @override
  State<PaymentMethodsScreen> createState() => _PaymentMethodsScreenState();
}

class _PaymentMethodsScreenState extends State<PaymentMethodsScreen> {
  int _selectedPaymentIndex = 0;

  final List<Map<String, dynamic>> _paymentMethods = [
    {
      'type': 'UPI',
      'identifier': 'karthik.murugan@okaxis',
      'icon': Icons.account_balance_wallet_rounded,
    },
    {
      'type': 'Credit Card',
      'identifier': '**** **** **** 4829',
      'icon': Icons.credit_card_rounded,
    },
    {
      'type': 'Debit Card',
      'identifier': '**** **** **** 5421',
      'icon': Icons.credit_card_rounded,
    },
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Payment Methods'),
        centerTitle: true,
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: _paymentMethods.length,
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (context, index) {
                final method = _paymentMethods[index];
                final isSelected = _selectedPaymentIndex == index;

                return GestureDetector(
                  onTap: () => setState(() => _selectedPaymentIndex = index),
                  child: Container(
                    decoration: BoxDecoration(
                      border: Border.all(
                        color: isSelected ? TruxifyColors.accent : (Theme.of(context).brightness == Brightness.dark ? TruxifyColors.darkBorder : TruxifyColors.border),
                        width: isSelected ? 2 : 1,
                      ),
                      borderRadius: BorderRadius.circular(12),
                      color: isSelected
                          ? TruxifyColors.accent.withValues(alpha: 0.08)
                          : Theme.of(context).colorScheme.surface,
                    ),
                    padding: const EdgeInsets.all(14),
                    child: Row(
                      children: [
                        Container(
                          width: 44,
                          height: 44,
                          decoration: BoxDecoration(
                            color: TruxifyColors.accentLight,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Icon(method['icon'], color: TruxifyColors.accent, size: 22),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                method['type'],
                                style: Theme.of(context).textTheme.labelMedium?.copyWith(
                                      fontWeight: FontWeight.w600,
                                    ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                method['identifier'],
                                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                      color: TruxifyColors.adaptiveSecondaryText(context),
                                    ),
                              ),
                            ],
                          ),
                        ),
                        if (isSelected)
                          const Icon(Icons.check_circle_rounded, color: TruxifyColors.accent, size: 24),
                      ],
                    ),
                  ),
                );
              },
            ),
            const SizedBox(height: 28),
            OutlinedButton.icon(
              onPressed: () {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Add new payment method')),
                );
              },
              icon: const Icon(Icons.add_rounded),
              label: const Text('Add New Payment Method'),
            ),
            const SizedBox(height: 20),
            PrimaryButton(
              label: 'Confirm',
              onPressed: () => Navigator.of(context).pop(),
            ),
          ],
        ),
      ),
    );
  }
}
