import 'dart:async';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../theme/app_theme.dart';

class MyDocumentsScreen extends StatefulWidget {
  const MyDocumentsScreen({super.key});

  @override
  State<MyDocumentsScreen> createState() => _MyDocumentsScreenState();
}

class _MyDocumentsScreenState extends State<MyDocumentsScreen> {
  final _supabase = Supabase.instance.client;
  
  bool _isOffline = false;
  bool _isLoading = true;
  String? _error;
  List<Map<String, dynamic>> _documents = [];
  String? _selectedUploadType;

  @override
  void initState() {
    super.initState();
    _fetchDocuments();
  }

  Future<void> _fetchDocuments() async {
    final connectivity = await Connectivity().checkConnectivity();
    final hasNetwork = connectivity.isNotEmpty && !connectivity.contains(ConnectivityResult.none);
    
    setState(() {
      _isOffline = !hasNetwork;
      _isLoading = true;
      _error = null;
    });

    if (!hasNetwork) {
      setState(() {
        _isLoading = false;
        _error = 'You are currently offline. Cannot fetch live documents.';
      });
      return;
    }

    try {
      final user = _supabase.auth.currentUser;
      final userId = user?.id ?? 'b1111111-1111-1111-1111-111111111111'; // Fallback to seed customer
      
      final response = await _supabase
          .from('documents')
          .select()
          .eq('user_id', userId)
          .order('updated_at', ascending: false);
          
      if (!mounted) return;

      setState(() {
        _documents = List<Map<String, dynamic>>.from(response);
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  String _mapUiToDbDocType(String uiType) {
    switch (uiType) {
      case 'Aadhar Card':
        return 'aadhar';
      case 'PAN Card':
        return 'pan';
      case 'Business License':
        return 'business_license';
      case 'Bank Account':
        return 'bank_account';
      default:
        return 'aadhar'; 
    }
  }

  String _mapDbToUiDocType(String dbType) {
    switch (dbType) {
      case 'aadhar':
        return 'Aadhar Card';
      case 'pan':
        return 'PAN Card';
      case 'business_license':
        return 'Business License';
      case 'bank_account':
        return 'Bank Account';
      default:
        return dbType.isNotEmpty
            ? dbType[0].toUpperCase() + dbType.substring(1)
            : 'Document';
    }
  }

  IconData _iconForDbDocType(String? dbType) {
    switch (dbType) {
      case 'pan':
        return Icons.credit_card_rounded;
      case 'business_license':
        return Icons.description_rounded;
      case 'bank_account':
        return Icons.account_balance_rounded;
      case 'aadhar':
      default:
        return Icons.card_membership_rounded;
    }
  }

  bool _isWarning(Map<String, dynamic> doc) {
    final status = (doc['status'] ?? '').toString().toLowerCase();
    if (status == 'expired' || status == 'expiring_soon' || status == 'rejected') {
      return true;
    }

    final validUntilStr = doc['valid_until'] as String?;
    if (validUntilStr != null) {
      final validUntil = DateTime.tryParse(validUntilStr);
      if (validUntil != null) {
        final daysUntilExpiry = validUntil.difference(DateTime.now()).inDays;
        if (daysUntilExpiry <= 30) return true;
      }
    }
    return false;
  }

  Future<void> _simulateUpload(BuildContext context, String docType) async {
    double progress = 0.0;
    String statusText = 'Reading file contents...';
    bool isDone = false;
    bool isError = false;

    await showModalBottomSheet<void>(
      context: context,
      isDismissible: false,
      enableDrag: false,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            if (progress == 0.0 && !isError) {
              Timer.periodic(const Duration(milliseconds: 300), (timer) async {
                if (!context.mounted) {
                  timer.cancel();
                  return;
                }

                if (progress < 0.8) {
                  setSheetState(() {
                    progress += 0.15;
                    if (progress > 0.7) {
                      statusText = 'Processing document...';
                    } else if (progress > 0.4) {
                      statusText = 'Uploading to secure storage...';
                    }
                  });
                } else if (progress >= 0.8 && progress < 1.0) {
                  timer.cancel(); 
                  setSheetState(() {
                    statusText = 'Verifying document...';
                  });

                  try {
                    final user = _supabase.auth.currentUser;
                    final userId = user?.id ?? 'b1111111-1111-1111-1111-111111111111'; 
                    final dbDocType = _mapUiToDbDocType(docType);

                    final existingDocs = await _supabase
                        .from('documents')
                        .select('id')
                        .eq('user_id', userId)
                        .eq('doc_type', dbDocType)
                        .limit(1);

                    final payload = {
                      'user_id': userId,
                      'doc_type': dbDocType,
                      'status': 'pending',
                      'valid_until': DateTime.now().add(const Duration(days: 365)).toIso8601String(),
                    };

                    if (existingDocs.isNotEmpty) {
                      payload['id'] = existingDocs.first['id'];
                    }

                    await _supabase.from('documents').upsert(payload);

                    if (context.mounted) {
                      setSheetState(() {
                        progress = 1.0;
                        isDone = true;
                        statusText = 'Upload Successful!';
                      });
                      _fetchDocuments();
                    }
                  } catch (e) {
                    if (context.mounted) {
                      setSheetState(() {
                        isError = true;
                        statusText = 'Upload Failed: $e';
                      });
                    }
                  }
                }
              });
            }

            return Padding(
              padding: const EdgeInsets.fromLTRB(24, 24, 24, 30),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.grey.withOpacity(0.3),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  const SizedBox(height: 20),
                  Text(
                    isDone ? 'Upload Complete' : (isError ? 'Upload Error' : 'Uploading Document'),
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    docType,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: isError ? Colors.red : TruxifyColors.accentDark,
                    ),
                  ),
                  const SizedBox(height: 24),
                  if (!isDone && !isError) ...[
                    SizedBox(
                      height: 80,
                      width: 80,
                      child: Stack(
                        alignment: Alignment.center,
                        children: [
                          CircularProgressIndicator(
                            value: progress,
                            strokeWidth: 6,
                            color: TruxifyColors.accent,
                            backgroundColor: TruxifyColors.accentLight,
                          ),
                          Text(
                            '${(progress * 100).toInt()}%',
                            style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 20),
                    Text(
                      statusText,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Colors.grey),
                    ),
                  ] else if (isError) ...[
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: const BoxDecoration(
                        color: Colors.redAccent,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.error_outline_rounded, color: Colors.white, size: 48),
                    ),
                    const SizedBox(height: 16),
                    Text(statusText, textAlign: TextAlign.center, style: const TextStyle(color: Colors.red)),
                    const SizedBox(height: 24),
                    ElevatedButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('Close'),
                    ),
                  ] else ...[
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.green.shade100,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.check_circle_rounded, color: Colors.green, size: 48),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      statusText,
                      style: const TextStyle(color: Colors.green, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 24),
                    ElevatedButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('Back to Documents'),
                    ),
                  ],
                ],
              ),
            );
          },
        );
      },
    );
  }

  Future<void> _showUploadSheet(BuildContext context) async {
    String selectedType = _selectedUploadType ?? 'Aadhar Card';
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        return Padding(
          padding: const EdgeInsets.fromLTRB(20, 10, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  margin: const EdgeInsets.only(bottom: 16),
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Colors.grey.withOpacity(0.3),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              Text(
                'Upload New Document',
                style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 16),
              StatefulBuilder(
                builder: (context, setSheetState) {
                  return Column(
                    children: [
                      ...[
                        'Aadhar Card',
                        'PAN Card',
                        'Business License',
                        'Bank Account',
                      ].map((type) {
                        final isSelected = selectedType == type;
                        return GestureDetector(
                          onTap: () {
                            setSheetState(() => selectedType = type);
                            setState(() => _selectedUploadType = type);
                          },
                          child: Container(
                            margin: const EdgeInsets.only(bottom: 8),
                            padding: const EdgeInsets.all(14),
                            decoration: BoxDecoration(
                              color: isSelected
                                  ? TruxifyColors.accentDark
                                  : Theme.of(context).colorScheme.surface,
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(
                                color: isSelected
                                    ? TruxifyColors.accent
                                    : TruxifyColors.border,
                              ),
                            ),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  type,
                                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                    fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                                  ),
                                ),
                                if (isSelected)
                                  const Icon(Icons.check_circle_rounded, color: TruxifyColors.accent),
                              ],
                            ),
                          ),
                        );
                      }),
                      const SizedBox(height: 16),
                      ElevatedButton(
                        onPressed: () {
                          Navigator.of(context).pop();
                          _simulateUpload(context, selectedType);
                        },
                        style: ElevatedButton.styleFrom(
                          minimumSize: const Size(double.infinity, 50),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                        child: const Text('Continue Upload'),
                      ),
                    ],
                  );
                },
              ),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('My Documents'),
        centerTitle: true,
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _fetchDocuments,
          )
        ],
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
                  'Offline mode',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Colors.red),
                ),
              ),
            if (_isLoading)
              const Center(child: Padding(
                padding: EdgeInsets.all(40.0),
                child: CircularProgressIndicator(),
              ))
            else if (_error != null)
              Center(
                child: Padding(
                  padding: const EdgeInsets.all(24.0),
                  child: Column(
                    children: [
                      const Icon(Icons.error_outline, color: Colors.red, size: 48),
                      const SizedBox(height: 16),
                      Text('Failed to load documents.\n$_error', textAlign: TextAlign.center, style: const TextStyle(color: Colors.red)),
                      const SizedBox(height: 24),
                      ElevatedButton(onPressed: _fetchDocuments, child: const Text('Retry')),
                    ],
                  ),
                ),
              )
            else if (_documents.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 40),
                child: Center(
                  child: Text(
                    'No documents found.',
                    style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: Colors.grey),
                  ),
                ),
              )
            else
              ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: _documents.length,
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (context, index) {
                  final doc = _documents[index];
                  final dbType = doc['doc_type'] as String? ?? '';
                  final statusStr = doc['status'] as String? ?? 'pending';
                  
                  final isWarning = _isWarning(doc);
                  final isPending = statusStr.toLowerCase() == 'pending';

                  final title = _mapDbToUiDocType(dbType);
                  final icon = _iconForDbDocType(dbType);

                  final statusColor = isWarning 
                    ? Colors.red 
                    : (isPending ? Colors.orange : Colors.green);
                  final statusText = isWarning
                    ? 'Expiring'
                    : (isPending ? 'Pending' : 'Verified');

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
                            color: isWarning ? Colors.red.withOpacity(0.1) : TruxifyColors.accentLight,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Icon(icon, color: isWarning ? Colors.red : TruxifyColors.accent, size: 22),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                title,
                                style: Theme.of(context).textTheme.labelMedium?.copyWith(
                                      fontWeight: FontWeight.w600,
                                    ),
                              ),
                              const SizedBox(height: 4),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(
                                  color: statusColor.withOpacity(0.15),
                                  borderRadius: BorderRadius.circular(4),
                                ),
                                child: Text(
                                  statusText,
                                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                                        color: statusColor,
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
              onPressed: () => _showUploadSheet(context),
              icon: const Icon(Icons.upload_rounded),
              label: const Text('Upload New Document'),
            ),
          ],
        ),
      ),
    );
  }
}
