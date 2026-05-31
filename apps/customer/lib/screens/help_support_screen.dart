import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';

class _FaqItem {
  const _FaqItem({required this.question, required this.answer});

  final String question;
  final String answer;
}

class HelpSupportScreen extends StatelessWidget {
  const HelpSupportScreen({super.key});

  @override
  Widget build(BuildContext context) {
    const faqs = [
      _FaqItem(
        question: 'How do I book a truck?',
        answer: 'To book a truck, go to Home, enter your pickup and drop locations, select a truck, and confirm your booking.',
      ),
      _FaqItem(
        question: 'What payment methods are accepted?',
        answer: 'We accept UPI, credit cards, debit cards, and net banking for all your transactions.',
      ),
      _FaqItem(
        question: 'Can I cancel my order?',
        answer: 'You can cancel your order before the truck is assigned. After assignment, a cancellation fee may apply.',
      ),
      _FaqItem(
        question: 'How do I track my shipment?',
        answer: 'You can track your shipment in real-time from the Orders section using the live tracking feature.',
      ),
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Help & Support'),
        centerTitle: true,
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              decoration: BoxDecoration(
                color: Theme.of(context).brightness == Brightness.dark
                    ? TruxifyColors.darkAccentLight
                    : TruxifyColors.accentLight.withValues(alpha: 0.5),
                borderRadius: BorderRadius.circular(12),
              ),
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: TruxifyColors.accentLight,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Icon(Icons.help_outline_rounded, color: TruxifyColors.accent, size: 20),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Need Immediate Help?',
                          style: Theme.of(context).textTheme.labelMedium?.copyWith(
                                fontWeight: FontWeight.w600,
                              ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          'Contact our support team',
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                color: TruxifyColors.adaptiveSecondaryText(context),
                              ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
            Text(
              'Frequently Asked Questions',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
            ),
            const SizedBox(height: 12),
            ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: faqs.length,
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (context, index) {
                final faq = faqs[index];
                return Theme(
                  data: Theme.of(context).copyWith(
                    dividerColor: Colors.transparent,
                  ),
                  child: ExpansionTile(
                    title: Text(
                      faq.question,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            fontWeight: FontWeight.w500,
                          ),
                    ),
                    children: [
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                        child: Text(
                          faq.answer,
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                color: TruxifyColors.adaptiveSecondaryText(context),
                              ),
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
            const SizedBox(height: 28),
            PrimaryButton(
              label: 'Contact Support',
              onPressed: () {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Opening support chat...')),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}
