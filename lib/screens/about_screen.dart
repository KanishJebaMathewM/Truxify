import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class AboutScreen extends StatelessWidget {
  const AboutScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('About Truckify'),
        centerTitle: true,
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 100,
                height: 100,
                decoration: BoxDecoration(
                  color: FreightFairColors.accentLight,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: const Icon(
                  Icons.local_shipping_rounded,
                  color: FreightFairColors.accent,
                  size: 50,
                ),
              ),
            ),
            const SizedBox(height: 20),
            Center(
              child: Column(
                children: [
                  Text(
                    'Truckify',
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                          fontWeight: FontWeight.w700,
                          color: FreightFairColors.accent,
                        ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Version 1.0.0',
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: FreightFairColors.secondaryText,
                        ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
            Container(
              decoration: BoxDecoration(
                color: Colors.grey.shade100,
                borderRadius: BorderRadius.circular(12),
              ),
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'About Us',
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                          color: FreightFairColors.accent,
                        ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Truckify is a modern freight management platform connecting shippers with verified truck owners. We simplify logistics with real-time tracking, transparent pricing, and reliable service.',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: FreightFairColors.secondaryText,
                          height: 1.6,
                        ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Container(
              decoration: BoxDecoration(
                color: Colors.grey.shade100,
                borderRadius: BorderRadius.circular(12),
              ),
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Our Mission',
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                          color: FreightFairColors.accent,
                        ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'To revolutionize the logistics industry by making freight transportation safe, affordable, and sustainable for everyone.',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: FreightFairColors.secondaryText,
                          height: 1.6,
                        ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
            Text(
              'Contact Information',
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                    fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 12),
            _ContactRow(
              icon: Icons.email_rounded,
              label: 'Email',
              value: 'support@truckify.com',
            ),
            const SizedBox(height: 12),
            _ContactRow(
              icon: Icons.phone_rounded,
              label: 'Phone',
              value: '+91 1800-TRUCK-1',
            ),
            const SizedBox(height: 12),
            _ContactRow(
              icon: Icons.public_rounded,
              label: 'Website',
              value: 'www.truckify.com',
            ),
            const SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: const [
                _SocialIcon(icon: Icons.facebook_rounded),
                SizedBox(width: 16),
                _SocialIcon(icon: Icons.language_rounded),
                SizedBox(width: 16),
                _SocialIcon(icon: Icons.mail_rounded),
              ],
            ),
            const SizedBox(height: 24),
            Center(
              child: Text(
                '© 2024 Truckify. All rights reserved.',
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: FreightFairColors.secondaryText,
                    ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ContactRow extends StatelessWidget {
  const _ContactRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: FreightFairColors.accentLight,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Icon(icon, color: FreightFairColors.accent, size: 18),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: FreightFairColors.secondaryText,
                    ),
              ),
              const SizedBox(height: 2),
              Text(
                value,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      fontWeight: FontWeight.w500,
                    ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _SocialIcon extends StatelessWidget {
  const _SocialIcon({required this.icon});

  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 40,
      height: 40,
      decoration: BoxDecoration(
        color: FreightFairColors.accentLight,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Icon(icon, color: FreightFairColors.accent, size: 18),
    );
  }
}
