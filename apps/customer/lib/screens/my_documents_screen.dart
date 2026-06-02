import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';

import '../core/offline/cache/cache_manager.dart';
import '../theme/app_theme.dart';

class MyDocumentsScreen extends StatefulWidget {
  const MyDocumentsScreen({super.key});

  static const List<Map<String, Object>> _documents = [
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

  @override
  State<MyDocumentsScreen> createState() => _MyDocumentsScreenState();
}

class _MyDocumentsScreenState extends State<MyDocumentsScreen> {
  final CacheManager _cacheManager = CacheManager();
  bool _isOffline = false;
  String? _lastUpdatedLabel;
  List<Map<String, dynamic>> _documents = [
    {
      'name': 'Aadhar Card',
      'status': 'Verified',
      'icon': 'card_membership_rounded',
      'statusColor': 'green',
    },
    {
      'name': 'PAN Card',
      'status': 'Verified',
      'icon': 'credit_card_rounded',
      'statusColor': 'green',
    },
    {
      'name': 'Business License',
      'status': 'Pending',
      'icon': 'description_rounded',
      'statusColor': 'orange',
    },
    {
      'name': 'Bank Account',
      'status': 'Verified',
      'icon': 'account_balance_rounded',
      'statusColor': 'green',
    },
  ];

  @override
  void initState() {
    super.initState();
    _loadDocuments();
  }

  Future<void> _loadDocuments() async {
    final connectivity = await Connectivity().checkConnectivity();
    final hasNetwork = connectivity != ConnectivityResult.none;
    await _cacheManager.open();
    await _cacheManager.cacheDocuments(_documents);

    final cachedDocuments = await _cacheManager.getDocuments();
    if (!mounted) return;

    setState(() {
      _isOffline = !hasNetwork;
      _documents = cachedDocuments.isNotEmpty ? cachedDocuments : _documents;
      _lastUpdatedLabel = cachedDocuments.isNotEmpty ? cachedDocuments.first['_cached_at']?.toString() : null;
    });
  }

  IconData _iconFor(String? value) {
    switch (value) {
      case 'credit_card_rounded':
        return Icons.credit_card_rounded;
      case 'description_rounded':
        return Icons.description_rounded;
      case 'account_balance_rounded':
        return Icons.account_balance_rounded;
      default:
        return Icons.card_membership_rounded;
    }
  }

  Color _colorFor(String? value) {
    switch (value) {
      case 'orange':
        return Colors.orange;
      default:
        return Colors.green;
    }
  }

  String _formatLastUpdated(String? updatedAt) {
    if (updatedAt == null || updatedAt.isEmpty) return 'just now';
    final lastUpdated = DateTime.tryParse(updatedAt);
    if (lastUpdated == null) return 'just now';
    final minutes = DateTime.now().difference(lastUpdated).inMinutes;
    if (minutes < 1) return 'just now';
    return minutes == 1 ? '1 min ago' : '$minutes mins ago';
  }

  @override
  Widget build(BuildContext context) {
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
            if (_isOffline)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Text(
                  'Offline mode • Last updated ${_formatLastUpdated(_lastUpdatedLabel)}',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(color: TruxifyColors.accentDark),
                ),
              ),
            ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: _documents.length,
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (context, index) {
                final doc = _documents[index];
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
                        child: Icon(_iconFor(doc['icon']?.toString()), color: TruxifyColors.accent, size: 22),
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
                                color: _colorFor(doc['statusColor']?.toString()).withValues(alpha: 0.15),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Text(
                                doc['status'] as String,
                                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                                      color: _colorFor(doc['statusColor']?.toString()),
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

