import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class MyDocumentsScreen extends StatelessWidget {
  const MyDocumentsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final documents = <Map<String, dynamic>>[
      {
        'name': 'Aadhar Card',
        'status': 'Verified',
        'icon': Icons.card_membership_rounded,
        'statusColor': Colors.green,
      },
      {
        'name': 'PAN Card',
        'status': 'Verified',
        'icon': Icons.credit_card_rounded,
        'statusColor': Colors.green,
      },
      {
        'name': 'Business License',
        'status': 'Pending',
        'icon': Icons.description_rounded,
        'statusColor': Colors.orange,
      },
      {
        'name': 'Bank Account',
        'status': 'Verified',
        'icon': Icons.account_balance_rounded,
        'statusColor': Colors.green,
      },
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('My Documents'),
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
              itemCount: documents.length,
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (context, index) {
                final doc = documents[index];
                return Container(
                  decoration: BoxDecoration(
                    border: Border.all(color: (Theme.of(context).brightness == Brightness.dark ? TruxifyColors.darkBorder : TruxifyColors.border)),
                    borderRadius: BorderRadius.circular(12),
                    color: Theme.of(context).colorScheme.surface,
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
                        child: Icon(doc['icon'] as IconData, color: TruxifyColors.accent, size: 22),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              doc['name'] as String,
                              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                                    fontWeight: FontWeight.w600,
                                  ),
                            ),
                            const SizedBox(height: 4),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                              decoration: BoxDecoration(
                                color: (doc['statusColor'] as Color).withValues(alpha: 0.15),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Text(
                                doc['status'] as String,
                                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                                      color: doc['statusColor'],
                                      fontWeight: FontWeight.w600,
                                      fontSize: 10,
                                    ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const Icon(Icons.chevron_right_rounded, color: Colors.grey),
                    ],
                  ),
                );
              },
            ),
            const SizedBox(height: 28),
            OutlinedButton.icon(
              onPressed: () {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Upload new document')),
                );
              },
              icon: const Icon(Icons.upload_rounded),
              label: const Text('Upload New Document'),
            ),
          ],
        ),
      ),
    );
  }
}
