import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';

class SavedAddressesScreen extends StatefulWidget {
  const SavedAddressesScreen({super.key});

  @override
  State<SavedAddressesScreen> createState() => _SavedAddressesScreenState();
}

class _SavedAddressesScreenState extends State<SavedAddressesScreen> {
  int _selectedAddressIndex = 0;

  final List<Map<String, dynamic>> _addresses = [
    {
      'label': 'Office',
      'address': '123 Business Park, Mumbai, Maharashtra 400001',
      'icon': Icons.business_rounded,
    },
    {
      'label': 'Home',
      'address': '456 Residential Complex, Surat, Gujarat 395001',
      'icon': Icons.home_rounded,
    },
    {
      'label': 'Warehouse',
      'address': '789 Industrial Area, Ahmedabad, Gujarat 380001',
      'icon': Icons.warehouse_rounded,
    },
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Saved Addresses'),
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
              itemCount: _addresses.length,
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (context, index) {
                final address = _addresses[index];
                final isSelected = _selectedAddressIndex == index;

                return GestureDetector(
                  onTap: () => setState(() => _selectedAddressIndex = index),
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
                          child: Icon(address['icon'], color: TruxifyColors.accent, size: 22),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                address['label'],
                                style: Theme.of(context).textTheme.labelMedium?.copyWith(
                                      fontWeight: FontWeight.w600,
                                    ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                address['address'],
                                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                      color: TruxifyColors.adaptiveSecondaryText(context),
                                    ),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
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
                  const SnackBar(content: Text('Add new address')),
                );
              },
              icon: const Icon(Icons.add_location_rounded),
              label: const Text('Add New Address'),
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
