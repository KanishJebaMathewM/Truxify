import 'dart:async';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';

class DocumentsScreen extends StatefulWidget {
  const DocumentsScreen({super.key});

  @override
  State<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends State<DocumentsScreen> {
  final _supabase = Supabase.instance.client;
  List<Map<String, dynamic>> _documents = [];
  bool _isLoading = true;
  String? _error;
  String? _selectedUploadType;

  @override
  void initState() {
    super.initState();
    _fetchDocuments();
  }

  Future<void> _fetchDocuments() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final user = _supabase.auth.currentUser;
      final userId = user?.id ??
          'b2222222-2222-2222-2222-222222222222'; // Fallback to seed driver

      // Fetch documents belonging to the logged-in user
      final response = await _supabase
          .from('documents')
          .select()
          .eq('user_id', userId)
          .order('updated_at', ascending: false);

      setState(() {
        _documents = List<Map<String, dynamic>>.from(response);
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  // Map UI labels to Database doc_type enums (Must match SQL Check Constraint exactly)
  String _mapUiToDbDocType(String uiType) {
    switch (uiType) {
      case 'RC Book':
        return 'rc_book';
      case 'Driving Licence':
        return 'driving_licence';
      case 'Insurance Policy':
        return 'insurance';
      case 'Pollution Certificate':
        return 'puc';
      default:
        return 'rc_book'; // Safe fallback
    }
  }

  // Map Database doc_type enums to UI labels
  String _mapDbToUiDocType(String dbType) {
    switch (dbType) {
      case 'rc_book':
        return 'RC Book';
      case 'driving_licence':
        return 'Driving Licence';
      case 'insurance':
        return 'Insurance Policy';
      case 'puc':
        return 'Pollution Certificate';
      case 'aadhar':
        return 'Aadhaar Card';
      case 'pan':
        return 'PAN Card';
      case 'business_license':
        return 'Business License';
      case 'bank_account':
        return 'Bank Account';
      default:
        // Fallback for unknown types (Capitalize first letter)
        return dbType.isNotEmpty
            ? dbType[0].toUpperCase() + dbType.substring(1)
            : 'Document';
    }
  }

  // Calculate if the document is expiring soon or expired
  bool _isWarning(Map<String, dynamic> doc) {
    final status = (doc['status'] ?? '').toString().toLowerCase();
    if (status == 'expired' ||
        status == 'expiring_soon' ||
        status == 'rejected') {
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

  // Helper to format ISO dates to readable UI dates
  String _formatDate(String? dateStr) {
    if (dateStr == null) return 'N/A';
    final date = DateTime.tryParse(dateStr);
    if (date == null) return 'N/A';

    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec'
    ];
    return '${date.day.toString().padLeft(2, '0')} ${months[date.month - 1]} ${date.year}';
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
            // Start a timer to increment progress
            if (progress == 0.0 && !isError) {
              Timer.periodic(const Duration(milliseconds: 300), (timer) async {
                if (!context.mounted) {
                  timer.cancel();
                  return;
                }

                // Simulate network/blockchain upload phases
                if (progress < 0.8) {
                  setSheetState(() {
                    progress += 0.15;
                    if (progress > 0.7) {
                      statusText = 'Encrypting document payload...';
                    } else if (progress > 0.4) {
                      statusText =
                          'Uploading blocks to decentralised storage...';
                    }
                  });
                } else if (progress >= 0.8 && progress < 1.0) {
                  timer.cancel(); // Stop timer to do actual Supabase insert
                  setSheetState(() {
                    statusText = 'Registering with Truxify Network...';
                  });

                  try {
                    final user = _supabase.auth.currentUser;
                    final userId = user?.id ??
                        'b2222222-2222-2222-2222-222222222222'; // Fallback to seed driver
                    final dbDocType = _mapUiToDbDocType(docType);

                    // 1. Fetch existing document to prevent duplicates
                    final existingDocs = await _supabase
                        .from('documents')
                        .select('id')
                        .eq('user_id', userId)
                        .eq('doc_type', dbDocType)
                        .limit(1);

                    // 2. Prepare payload
                    final payload = {
                      'user_id': userId,
                      'doc_type': dbDocType,
                      'status':
                          'pending', // In a real app this might be 'pending' initially
                      'file_url':
                          'https://example.com/vault/${dbDocType}_${DateTime.now().millisecondsSinceEpoch}.pdf',
                      'blockchain_hash':
                          '0x${DateTime.now().millisecondsSinceEpoch.toRadixString(16)}...${userId.substring(0, 4)}',
                      'valid_until': DateTime.now()
                          .add(const Duration(days: 365))
                          .toIso8601String(),
                    };

                    // 3. If exists, attach the ID so it updates instead of inserting a duplicate
                    if (existingDocs.isNotEmpty) {
                      payload['id'] = existingDocs.first['id'];
                    }

                    // 4. Perform the upsert
                    await _supabase.from('documents').upsert(payload);

                    if (context.mounted) {
                      setSheetState(() {
                        progress = 1.0;
                        isDone = true;
                        statusText = 'Upload Successful & Encrypted!';
                      });
                      // Refresh the list behind the bottom sheet
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
              padding: const EdgeInsets.fromLTRB(24, 12, 24, 30),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const BottomSheetHandle(),
                  const SizedBox(height: 20),
                  Text(
                    isDone
                        ? 'Upload Complete'
                        : (isError ? 'Upload Error' : 'Uploading Document'),
                    style: GoogleFonts.dmSans(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    docType,
                    style: GoogleFonts.dmSans(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: isError
                          ? TruxifyColors.warning
                          : TruxifyColors.accentDark,
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
                            style: GoogleFonts.robotoMono(
                              fontSize: 15,
                              fontWeight: FontWeight.bold,
                              color: Theme.of(context).colorScheme.onSurface,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 20),
                    Text(
                      statusText,
                      style: GoogleFonts.dmSans(
                        fontSize: 13,
                        color: TruxifyColors.adaptiveSecondaryText(context),
                      ),
                    ),
                  ] else if (isError) ...[
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: const BoxDecoration(
                        color: TruxifyColors.warningLight,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.error_outline_rounded,
                        color: TruxifyColors.warning,
                        size: 48,
                      ),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      statusText,
                      textAlign: TextAlign.center,
                      style: GoogleFonts.dmSans(
                        fontSize: 13,
                        fontWeight: FontWeight.bold,
                        color: TruxifyColors.warning,
                      ),
                    ),
                    const SizedBox(height: 24),
                    PrimaryButton(
                      label: 'Close',
                      onPressed: () => Navigator.pop(context),
                    ),
                  ] else ...[
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: const BoxDecoration(
                        color: TruxifyColors.successLight,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.check_circle_rounded,
                        color: TruxifyColors.success,
                        size: 48,
                      ),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      statusText,
                      style: GoogleFonts.dmSans(
                        fontSize: 13,
                        fontWeight: FontWeight.bold,
                        color: TruxifyColors.success,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Decentralised verification complete.',
                      textAlign: TextAlign.center,
                      style: GoogleFonts.robotoMono(
                        fontSize: 10,
                        color: TruxifyColors.adaptiveSecondaryText(context),
                      ),
                    ),
                    const SizedBox(height: 24),
                    PrimaryButton(
                      label: 'Back to Documents',
                      onPressed: () => Navigator.pop(context),
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
    String selectedType = _selectedUploadType ?? 'RC Book';
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
              const BottomSheetHandle(),
              const SizedBox(height: 16),
              Text(
                'Upload New Document',
                style: GoogleFonts.dmSans(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                  color: Theme.of(context).colorScheme.onSurface,
                ),
              ),
              const SizedBox(height: 16),
              StatefulBuilder(
                builder: (context, setSheetState) {
                  return Column(
                    children: [
                      ...[
                        'RC Book',
                        'Driving Licence',
                        'Insurance Policy',
                        'Pollution Certificate',
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
                                  ? (Theme.of(context).brightness ==
                                          Brightness.dark
                                      ? TruxifyColors.darkAccentLight
                                      : TruxifyColors.accentLight)
                                  : Theme.of(context).colorScheme.surface,
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(
                                color: isSelected
                                    ? TruxifyColors.accent
                                    : (Theme.of(context).brightness ==
                                            Brightness.dark
                                        ? TruxifyColors.darkBorder
                                        : TruxifyColors.border),
                              ),
                            ),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  type,
                                  style: GoogleFonts.dmSans(
                                    fontSize: 14,
                                    fontWeight: isSelected
                                        ? FontWeight.bold
                                        : FontWeight.normal,
                                    color:
                                        Theme.of(context).colorScheme.onSurface,
                                  ),
                                ),
                                if (isSelected)
                                  const Icon(Icons.check_circle_rounded,
                                      color: TruxifyColors.accent),
                              ],
                            ),
                          ),
                        );
                      }),
                      const SizedBox(height: 16),
                      PrimaryButton(
                        label: 'Continue Upload',
                        onPressed: () {
                          Navigator.of(context).pop();
                          _simulateUpload(context, selectedType);
                        },
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

  Future<void> _showDocumentPreviewSheet(
    BuildContext context,
    String title,
    String docNumber,
    String lastVerified,
    String validUntil,
    bool isWarning,
  ) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        return Padding(
          padding: const EdgeInsets.fromLTRB(20, 10, 20, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const BottomSheetHandle(),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    title,
                    style: GoogleFonts.dmSans(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: isWarning
                          ? TruxifyColors.warningLight
                          : TruxifyColors.successLight,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      isWarning ? 'EXPIRING' : 'VERIFIED',
                      style: GoogleFonts.dmSans(
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                        color: isWarning
                            ? TruxifyColors.warning
                            : TruxifyColors.success,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: TruxifyColors.border),
                ),
                child: Column(
                  children: [
                    Icon(
                      isWarning
                          ? Icons.warning_amber_rounded
                          : Icons.verified_user_rounded,
                      color: isWarning
                          ? TruxifyColors.warning
                          : TruxifyColors.success,
                      size: 48,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Decentralised Verification Status',
                      style: GoogleFonts.dmSans(
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          color: TruxifyColors.primaryText),
                    ),
                    const SizedBox(height: 20),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Document ID:',
                            style: GoogleFonts.dmSans(
                                fontSize: 12, color: TruxifyColors.hintText)),
                        Expanded(
                          child: Text(docNumber,
                              textAlign: TextAlign.right,
                              overflow: TextOverflow.ellipsis,
                              style: GoogleFonts.robotoMono(
                                  fontSize: 11,
                                  fontWeight: FontWeight.bold,
                                  color: TruxifyColors.primaryText)),
                        ),
                      ],
                    ),
                    const Divider(height: 16, color: TruxifyColors.border),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Last Verified:',
                            style: GoogleFonts.dmSans(
                                fontSize: 12, color: TruxifyColors.hintText)),
                        Text(lastVerified,
                            style: GoogleFonts.dmSans(
                                fontSize: 12,
                                fontWeight: FontWeight.bold,
                                color: TruxifyColors.primaryText)),
                      ],
                    ),
                    const Divider(height: 16, color: TruxifyColors.border),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Valid Until:',
                            style: GoogleFonts.dmSans(
                                fontSize: 12, color: TruxifyColors.hintText)),
                        Text(validUntil,
                            style: GoogleFonts.dmSans(
                                fontSize: 12,
                                fontWeight: FontWeight.bold,
                                color: isWarning
                                    ? TruxifyColors.warning
                                    : TruxifyColors.primaryText)),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              Row(
                children: [
                  if (isWarning) ...[
                    Expanded(
                      child: OutlinedButton(
                        style: OutlinedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12)),
                          side: const BorderSide(color: TruxifyColors.accent),
                        ),
                        onPressed: () {
                          Navigator.pop(context);
                          _simulateUpload(context, title);
                        },
                        child: Text(
                          'Renew Now',
                          style: GoogleFonts.dmSans(
                            fontWeight: FontWeight.bold,
                            color: TruxifyColors.accentDark,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                  ],
                  Expanded(
                    child: PrimaryButton(
                      label: 'Close Preview',
                      onPressed: () => Navigator.pop(context),
                    ),
                  ),
                ],
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
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        backgroundColor: Theme.of(context).colorScheme.surface,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded,
              color: TruxifyColors.primaryText),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: Text(
          'My Documents',
          style: GoogleFonts.dmSans(
            fontSize: 16,
            fontWeight: FontWeight.bold,
            color: Theme.of(context).colorScheme.onSurface,
          ),
        ),
        shape: const Border(bottom: BorderSide(color: TruxifyColors.border)),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: TruxifyColors.primaryText),
            onPressed: _fetchDocuments,
          ),
        ],
      ),
      body: SafeArea(
        child: _isLoading
            ? const Center(
                child: CircularProgressIndicator(color: TruxifyColors.accent))
            : _error != null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24.0),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(Icons.error_outline,
                              color: TruxifyColors.warning, size: 48),
                          const SizedBox(height: 16),
                          Text(
                            'Failed to load documents.\n$_error',
                            textAlign: TextAlign.center,
                            style: GoogleFonts.dmSans(
                                color: TruxifyColors.warning),
                          ),
                          const SizedBox(height: 24),
                          PrimaryButton(
                            label: 'Retry',
                            onPressed: _fetchDocuments,
                          ),
                        ],
                      ),
                    ),
                  )
                : ListView(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                    children: [
                      // Render dynamic list from Supabase
                      ..._documents.map((doc) {
                        final isWarning = _isWarning(doc);
                        final title =
                            _mapDbToUiDocType(doc['doc_type'] as String? ?? '');

                        // Fallbacks for display
                        final hash = doc['blockchain_hash'] as String? ??
                            'Processing...';
                        final validUntilStr =
                            _formatDate(doc['valid_until'] as String?);

                        // Default to status if it exists, otherwise verified.
                        final statusStr = doc['status'] as String? ?? 'pending';
                        final isPending = statusStr.toLowerCase() == 'pending';

                        return Padding(
                          padding: const EdgeInsets.only(bottom: 14),
                          child: AppCard(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  mainAxisAlignment:
                                      MainAxisAlignment.spaceBetween,
                                  children: [
                                    Expanded(
                                      child: Text(
                                        title,
                                        style: GoogleFonts.dmSans(
                                          fontSize: 16,
                                          fontWeight: FontWeight.bold,
                                          color: Theme.of(context)
                                              .colorScheme
                                              .onSurface,
                                        ),
                                      ),
                                    ),
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                          horizontal: 8, vertical: 4),
                                      decoration: BoxDecoration(
                                        color: isWarning
                                            ? TruxifyColors.warningLight
                                            : (isPending
                                                ? Colors.orange
                                                    .withOpacity(0.15)
                                                : TruxifyColors.accentLight),
                                        borderRadius: BorderRadius.circular(12),
                                      ),
                                      child: Text(
                                        isWarning
                                            ? 'Expiring Soon'
                                            : (isPending
                                                ? 'Pending'
                                                : 'Verified'),
                                        style: GoogleFonts.dmSans(
                                          fontSize: 10,
                                          fontWeight: FontWeight.bold,
                                          color: isWarning
                                              ? TruxifyColors.warning
                                              : (isPending
                                                  ? Colors.orange.shade800
                                                  : TruxifyColors.accentDark),
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  isPending
                                      ? 'Awaiting verification node...'
                                      : 'Uploaded & Encrypted',
                                  style: GoogleFonts.dmSans(
                                    fontSize: 12,
                                    color: TruxifyColors.adaptiveSecondaryText(
                                        context),
                                  ),
                                ),
                                const SizedBox(height: 12),
                                const Divider(
                                    height: 1, color: TruxifyColors.border),
                                const SizedBox(height: 12),
                                _DocLine(
                                    label: 'Hash Tx:',
                                    value: hash.length > 20
                                        ? '${hash.substring(0, 15)}...'
                                        : hash,
                                    isMonospace: true),
                                _DocLine(
                                    label: 'Valid until',
                                    value: validUntilStr,
                                    isWarning: isWarning),
                                const SizedBox(height: 16),
                                Row(
                                  children: [
                                    Expanded(
                                      child: OutlinedButton(
                                        style: OutlinedButton.styleFrom(
                                          padding: const EdgeInsets.symmetric(
                                              vertical: 12),
                                          shape: RoundedRectangleBorder(
                                              borderRadius:
                                                  BorderRadius.circular(12)),
                                          side: const BorderSide(
                                              color: TruxifyColors.border),
                                        ),
                                        onPressed: () =>
                                            _showDocumentPreviewSheet(
                                          context,
                                          title,
                                          hash,
                                          _formatDate(doc['last_verified_at'] as String? ?? doc['created_at'] as String?),
                                          validUntilStr,
                                          isWarning,
                                        ),
                                        child: Text(
                                          'View',
                                          style: GoogleFonts.dmSans(
                                            fontWeight: FontWeight.bold,
                                            color: TruxifyColors
                                                .adaptiveSecondaryText(context),
                                          ),
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 12),
                                    Expanded(
                                      child: PrimaryButton(
                                        label: isWarning
                                            ? 'Renew Now'
                                            : 'Re-verify',
                                        onPressed: () {
                                          if (isWarning) {
                                            _simulateUpload(context, title);
                                          } else {
                                            ScaffoldMessenger.of(context)
                                                .showSnackBar(
                                              SnackBar(
                                                content: Text(
                                                    '$title re-verification request sent to RTO Node.'),
                                                backgroundColor:
                                                    TruxifyColors.success,
                                              ),
                                            );
                                          }
                                        },
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        );
                      }),

                      // Upload New Document Card
                      GestureDetector(
                        onTap: () => _showUploadSheet(context),
                        child: Container(
                          decoration: BoxDecoration(
                            color: Theme.of(context).colorScheme.surface,
                            borderRadius: BorderRadius.circular(16),
                            border: Border.all(
                                color: TruxifyColors.accent.withOpacity(0.3),
                                style: BorderStyle.solid),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(
                                vertical: 28, horizontal: 16),
                            child: Column(
                              children: [
                                const Icon(Icons.cloud_upload_outlined,
                                    color: TruxifyColors.accent, size: 36),
                                const SizedBox(height: 10),
                                Text(
                                  'Upload New Document',
                                  style: GoogleFonts.dmSans(
                                    fontSize: 14,
                                    fontWeight: FontWeight.bold,
                                    color: TruxifyColors.accentDark,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  'RC Book, Driving Licence, Insurance, PUC Certificate',
                                  style: GoogleFonts.dmSans(
                                    fontSize: 11,
                                    color: TruxifyColors.adaptiveSecondaryText(
                                        context),
                                  ),
                                  textAlign: TextAlign.center,
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
      ),
    );
  }
}

class _DocLine extends StatelessWidget {
  const _DocLine({
    required this.label,
    required this.value,
    this.isMonospace = false,
    this.isWarning = false,
  });

  final String label;
  final String value;
  final bool isMonospace;
  final bool isWarning;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: GoogleFonts.dmSans(
              fontSize: 12,
              color: TruxifyColors.adaptiveSecondaryText(context),
            ),
          ),
          Text(
            value,
            style: isMonospace
                ? GoogleFonts.robotoMono(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    color: Theme.of(context).colorScheme.onSurface,
                  )
                : GoogleFonts.dmSans(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: isWarning
                        ? TruxifyColors.warning
                        : TruxifyColors.primaryText,
                  ),
          ),
        ],
      ),
    );
  }
}
