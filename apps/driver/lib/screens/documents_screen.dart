import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify_driver/services/api_client.dart';
import 'package:truxify_driver/core/driver_session.dart';
import 'package:url_launcher/url_launcher.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';
import 'package:truxify_shared/truxify_shared.dart';

class DocumentsParseException implements Exception {
  const DocumentsParseException(this.message);
  final String message;

  @override
  String toString() => message;
}

class DriverDocument {
  const DriverDocument({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.docNumber,
    required this.lastVerified,
    required this.validUntil,
    required this.statusTone,
    required this.statusLabel,
    this.isGovtVerified = false,
  });

  final String id;
  final String title;
  final String subtitle;
  final String docNumber;
  final String lastVerified;
  final String validUntil;
  final String statusTone;
  final String statusLabel;
  final bool isGovtVerified;

  factory DriverDocument.fromMap(Map<String, dynamic> map) {
    final docType = map['doc_type'] as String? ?? '';
    final status = map['status'] as String? ?? 'pending';
    final isGovtVerified = map['is_govt_verified'] == true;

    return DriverDocument(
      id: map['id']?.toString() ?? '',
      title: _docTypeLabel(docType),
      subtitle: _docTypeSubtitle(docType),
      docNumber: () {
        final rawId = map['id']?.toString() ?? '';
        return rawId.length >= 8
            ? rawId.substring(0, 8).toUpperCase()
            : rawId.toUpperCase();
      }(),
      lastVerified: _formatDate(map['last_verified_at'] as String?),
      validUntil: _formatDate(map['valid_until'] as String?),
      statusTone: _statusTone(status),
      statusLabel: 'Document No.',
      isGovtVerified: isGovtVerified,
    );
  }

  static String _docTypeLabel(String docType) {
    const labels = {
      'rc_book': 'RC Book',
      'driving_licence': 'Driving Licence',
      'insurance': 'Insurance Policy',
      'puc': 'Pollution Certificate',
      'aadhar': 'Aadhaar Card',
      'pan': 'PAN Card',
      'business_license': 'Business License',
      'bank_account': 'Bank Account',
    };
    return labels[docType] ?? docType;
  }

  static String _docTypeSubtitle(String docType) {
    const subtitles = {
      'rc_book': 'Vehicle Registration Certificate',
      'driving_licence': 'Motor Vehicle Act License',
      'insurance': 'Commercial Vehicle Policy',
      'puc': 'Pollution Under Control Certificate',
      'aadhar': 'Government ID Proof',
      'pan': 'Income Tax Identity',
      'business_license': 'Business Registration',
      'bank_account': 'Bank Account Details',
    };
    return subtitles[docType] ?? '';
  }

  static String _formatDate(String? raw) {
    if (raw == null) return '—';
    try {
      final dt = DateTime.parse(raw);
      return '${dt.day.toString().padLeft(2, '0')}/'
          '${dt.month.toString().padLeft(2, '0')}/'
          '${dt.year}';
    } catch (e) {
      debugPrint('DocumentsScreen: failed to parse date "$raw": $e');
      return raw;
    }
  }

  static String _statusTone(String status) {
    switch (status) {
      case 'expiring_soon':
      case 'expired':
        return 'warning';
      case 'verified':
        return 'verified';
      default:
        return 'pending';
    }
  }
}

class DocumentsScreen extends StatefulWidget {
  const DocumentsScreen({super.key});

  @override
  State<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends State<DocumentsScreen> {
  SupabaseClient get _supabase => Supabase.instance.client;

  String? _selectedUploadType;
  late Future<List<DriverDocument>> _documentsFuture;
  bool _isDigilockerVerified = false;

  @override
  void initState() {
    super.initState();
    _checkDigilockerStatus();
    _documentsFuture = _fetchDocuments();
  }

  Future<void> _checkDigilockerStatus() async {
    try {
      final client = Supabase.instance.client;
      final userId = client.auth.currentUser?.id;
      if (userId != null) {
        final data = await client
            .from('profiles')
            .select('is_digilocker_verified')
            .eq('id', userId)
            .maybeSingle();
        if (data != null && mounted) {
          setState(() {
            _isDigilockerVerified = data['is_digilocker_verified'] as bool? ?? false;
          });
        }
      }
    } catch (e) {
      debugPrint('Failed to check Digilocker status: $e');
    }
  }

  Future<void> _startDigilockerOAuth(BuildContext context) async {
    if (!_requireAuth(context)) return;

    // Production builds must never run the fake Aadhaar/OTP theater or post a mock OAuth code.
    if (kReleaseMode) {
      await _startRealDigilockerLink(context);
      return;
    }

    // Debug/profile only: optional local mock gated behind kDebugMode.
    assert(() {
      return true;
    }());
    if (!kDebugMode) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'DigiLocker OAuth requires the real backend endpoint. Use a debug build for local mock testing.',
            ),
          ),
        );
      }
      return;
    }

    final aadhaarController = TextEditingController();
    final otpController = TextEditingController();
    var otpSent = false;
    var isVerifying = false;

    try {
      await showDialog<void>(
        context: context,
        barrierDismissible: true,
        builder: (dialogContext) {
          return StatefulBuilder(
            builder: (context, setDialogState) {
              return AlertDialog(
                backgroundColor: Theme.of(context).colorScheme.surface,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                title: Row(
                  children: [
                    const Icon(Icons.security_rounded, color: TruxifyColors.accent),
                    const SizedBox(width: 10),
                    Text(
                      'DigiLocker Login (Debug)',
                      style: GoogleFonts.dmSans(
                        fontWeight: FontWeight.bold,
                        color: Theme.of(context).colorScheme.onSurface,
                      ),
                    ),
                  ],
                ),
                content: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      'Debug mock only. Release builds use the real DigiLocker backend flow.',
                      style: GoogleFonts.dmSans(fontSize: 13, color: TruxifyColors.secondaryText),
                    ),
                    const SizedBox(height: 16),
                    if (!otpSent) ...[
                      TextField(
                        controller: aadhaarController,
                        keyboardType: TextInputType.number,
                        maxLength: 12,
                        decoration: InputDecoration(
                          labelText: 'Aadhaar Number',
                          hintText: 'Enter 12-digit Aadhaar',
                          labelStyle: GoogleFonts.dmSans(color: TruxifyColors.secondaryText),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                          counterText: '',
                        ),
                      ),
                    ] else ...[
                      Text(
                        'Enter the 6-digit OTP sent to your Aadhaar-linked mobile number.',
                        style: GoogleFonts.dmSans(fontSize: 13, color: TruxifyColors.secondaryText),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: otpController,
                        keyboardType: TextInputType.number,
                        maxLength: 6,
                        decoration: InputDecoration(
                          labelText: 'Aadhaar OTP',
                          hintText: 'Enter 6-digit OTP',
                          labelStyle: GoogleFonts.dmSans(color: TruxifyColors.secondaryText),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                          counterText: '',
                        ),
                      ),
                    ],
                    if (isVerifying) ...[
                      const SizedBox(height: 16),
                      const Center(child: CircularProgressIndicator(color: TruxifyColors.accent)),
                    ],
                  ],
                ),
                actions: [
                  TextButton(
                    onPressed: isVerifying ? null : () => Navigator.pop(dialogContext),
                    child: Text('Cancel', style: GoogleFonts.dmSans(color: TruxifyColors.secondaryText)),
                  ),
                  ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: TruxifyColors.accent,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                    onPressed: isVerifying
                        ? null
                        : () async {
                            if (!otpSent) {
                              if (aadhaarController.text.length < 12) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(content: Text('Please enter a valid 12-digit Aadhaar number')),
                                );
                                return;
                              }
                              setDialogState(() => isVerifying = true);
                              await Future<void>.delayed(const Duration(seconds: 1));
                              setDialogState(() {
                                otpSent = true;
                                isVerifying = false;
                              });
                              return;
                            }
                            if (otpController.text.length < 6) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(content: Text('Please enter the 6-digit OTP')),
                              );
                              return;
                            }
                            setDialogState(() => isVerifying = true);
                            try {
                              // Debug-only mock code — never used in release (gated above).
                              final apiClient = ApiClient();
                              final tokenRes = await apiClient.post('/api/verify/digilocker/token', {
                                'code': 'mock_auth_code_from_oauth',
                              });
                              final accessToken = tokenRes['data']?['access_token'];
                              if (accessToken == null) {
                                throw Exception('Failed to get access token from DigiLocker');
                              }
                              final verifyRes = await apiClient.post('/api/verify/digilocker/verify', {
                                'accessToken': accessToken,
                                'userId': Supabase.instance.client.auth.currentUser?.id,
                              });
                              if (verifyRes['success'] == true) {
                                if (dialogContext.mounted) Navigator.pop(dialogContext);
                                if (context.mounted) {
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(
                                      content: Text('DigiLocker verification succeeded! Documents verified on-chain.'),
                                      backgroundColor: Colors.green,
                                    ),
                                  );
                                }
                                await _checkDigilockerStatus();
                                if (mounted) {
                                  setState(() {
                                    _documentsFuture = _fetchDocuments();
                                  });
                                }
                              } else {
                                throw Exception('Verification failed');
                              }
                            } catch (e) {
                              if (dialogContext.mounted) Navigator.pop(dialogContext);
                              if (context.mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(content: Text('Verification failed: $e'), backgroundColor: Colors.red),
                                );
                              }
                            }
                          },
                    child: Text(
                      otpSent ? 'Verify' : 'Request OTP',
                      style: GoogleFonts.dmSans(color: Colors.white, fontWeight: FontWeight.bold),
                    ),
                  ),
                ],
              );
            },
          );
        },
      );
    } finally {
      aadhaarController.dispose();
      otpController.dispose();
    }
  }

  /// Production DigiLocker link: paste a real OAuth code and POST to backend.
  Future<void> _startRealDigilockerLink(BuildContext context) async {
    final codeController = TextEditingController();
    try {
      final code = await showDialog<String>(
        context: context,
        barrierDismissible: true,
        builder: (ctx) => AlertDialog(
          title: const Text('DigiLocker Verification'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'DigiLocker OAuth must use the real backend endpoint. '
                'Complete authorization with DigiLocker, then paste the authorization code here. '
                'Mock OTP flows are disabled in release builds.',
              ),
              const SizedBox(height: 12),
              TextField(
                controller: codeController,
                decoration: const InputDecoration(
                  hintText: 'Authorization code',
                  border: OutlineInputBorder(),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx, codeController.text.trim()),
              child: const Text('Verify'),
            ),
          ],
        ),
      );

      if (code == null || code.isEmpty) return;
      if (code == 'mock_auth_code_from_oauth') {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Mock DigiLocker codes are not allowed in release builds.'),
              backgroundColor: TruxifyColors.error,
            ),
          );
        }
        return;
      }

      final session = Supabase.instance.client.auth.currentSession;
      final token = session?.accessToken ?? '';
      final response = await http.post(
        Uri.parse('$_apiBaseUrl/api/documents/verify-digilocker'),
        headers: {
          'Content-Type': 'application/json',
          if (token.isNotEmpty) 'Authorization': 'Bearer $token',
        },
        body: jsonEncode({'code': code}),
      );

      if (!context.mounted) return;
      if (response.statusCode == 200) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Government documents linked successfully via DigiLocker.'),
            backgroundColor: TruxifyColors.success,
          ),
        );
        await _checkDigilockerStatus();
        if (mounted) {
          setState(() {
            _documentsFuture = _fetchDocuments();
          });
        }
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('DigiLocker link failed (HTTP ${response.statusCode}).'),
            backgroundColor: TruxifyColors.error,
          ),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('DigiLocker link failed: $e'),
            backgroundColor: TruxifyColors.error,
          ),
        );
      }
    } finally {
      codeController.dispose();
    }
  }

  Widget _buildDigilockerVerificationCard(BuildContext context) {
    if (_isDigilockerVerified) {
      return Container(
        margin: const EdgeInsets.only(bottom: 16),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.green.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Colors.green.withValues(alpha: 0.3), width: 1.5),
        ),
        child: Row(
          children: [
            const Icon(Icons.verified_rounded, color: Colors.green, size: 32),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'DigiLocker Verified',
                    style: GoogleFonts.dmSans(
                      fontSize: 15,
                      fontWeight: FontWeight.bold,
                      color: Colors.green.shade800,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Your Driving Licence, RC Book, and Insurance are securely verified on-chain.',
                    style: GoogleFonts.dmSans(fontSize: 12, color: Colors.green.shade900),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: TruxifyColors.accent.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: TruxifyColors.accent.withValues(alpha: 0.25), width: 1.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.document_scanner_rounded, color: TruxifyColors.accent, size: 28),
              const SizedBox(width: 10),
              Text(
                'Instant DigiLocker Verification',
                style: GoogleFonts.dmSans(
                  fontSize: 15,
                  fontWeight: FontWeight.bold,
                  color: TruxifyColors.accentDark,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            'Skip manual uploads! Fetch and verify your Driving Licence, RC Book, and Insurance directly from your government DigiLocker account.',
            style: GoogleFonts.dmSans(
              fontSize: 12,
              color: TruxifyColors.secondaryText,
            ),
          ),
          const SizedBox(height: 12),
          ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: TruxifyColors.accent,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              elevation: 0,
            ),
            onPressed: () => _startDigilockerOAuth(context),
            icon: const Icon(Icons.login_rounded, size: 18),
            label: Text(
              'Link DigiLocker Account',
              style: GoogleFonts.dmSans(fontSize: 13, fontWeight: FontWeight.bold),
            ),
          ),
        ],
      ),
    );
  }

  Future<List<DriverDocument>> _fetchDocuments() async {
  final driverId = DriverSession.driverId;

  if (driverId.isEmpty) {
    throw AuthException('No authenticated user. Please log in again.');
  }

  try {
    final dynamic response = await _supabase
        .from('documents')
        .select()
        .eq('user_id', driverId)
        .order('created_at', ascending: false);

    final documents = <DriverDocument>[];
    for (final dynamic row in response as Iterable) {
      if (row is! Map) continue;
      try {
        documents.add(DriverDocument.fromMap(Map<String, dynamic>.from(row)));
      } catch (_) {
        continue;
      }
    }

    return documents;
  } on AuthException {
    rethrow;
  } catch (e) {
    throw DocumentsParseException('Unable to read documents: $e');
  }
}

  static String get _apiBaseUrl => ApiClient.defaultBaseUrl;

  bool _requireAuth(BuildContext context) {
    if (DriverSession.driverId.isNotEmpty) return true;

    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('You must be logged in to upload documents.'),
        backgroundColor: TruxifyColors.error,
      ),
    );
    return false;
  }

  Future<void> _simulateUpload(BuildContext context, String docType) async {
    if (!_requireAuth(context)) return;

    double progress = 0.0;
    String statusText = 'Reading file contents...';
    bool isDone = false;
    Timer? uploadTimer;

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
            if (progress == 0.0) {
              uploadTimer?.cancel();
              uploadTimer = Timer.periodic(const Duration(milliseconds: 300), (timer) {
                if (!context.mounted) {
                  timer.cancel();
                  return;
                }
                setSheetState(() {
                  progress += 0.15;
                  if (progress >= 1.0) {
                    progress = 1.0;
                    statusText = 'Verifying document...';
                    timer.cancel();
                    Future.delayed(const Duration(milliseconds: 800), () {
                      if (context.mounted) {
                        setSheetState(() {
                          isDone = true;
                          statusText = 'Upload Successful!';
                        });
                      }
                    });
                  } else if (progress > 0.7) {
                    statusText = 'Uploading to secure storage...';
                  } else if (progress > 0.4) {
                    statusText = 'Processing document...';
                  }
                });
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
                    isDone ? 'Upload Complete' : 'Uploading Document',
                    style: GoogleFonts.dmSans(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                      color: TruxifyColors.primaryText,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    docType,
                    style: GoogleFonts.dmSans(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: TruxifyColors.accentDark,
                    ),
                  ),
                  const SizedBox(height: 24),
                  if (!isDone) ...[
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
                              color: TruxifyColors.primaryText,
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
                        color: TruxifyColors.secondaryText,
                      ),
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
    ).then((_) => uploadTimer?.cancel());
  }

  Future<void> _showUploadSheet(BuildContext context) async {
    if (!_requireAuth(context)) return;

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
                  color: TruxifyColors.primaryText,
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
                                  ? TruxifyColors.accentLight
                                  : Colors.grey.shade50,
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(
                                color: isSelected
                                    ? TruxifyColors.accent
                                    : Colors.grey.shade200,
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
                                    color: TruxifyColors.primaryText,
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
                      color: TruxifyColors.primaryText,
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
                  color: TruxifyColors.secondaryBackground,
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
                      'Document Status',
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
                        Text(docNumber,
                            style: GoogleFonts.robotoMono(
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                                color: TruxifyColors.primaryText)),
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
      backgroundColor: TruxifyColors.background,
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
            color: TruxifyColors.primaryText,
          ),
        ),
        shape: const Border(bottom: BorderSide(color: TruxifyColors.border)),
      ),
      body: SafeArea(
        child: FutureBuilder<List<DriverDocument>>(
          future: _documentsFuture,
          builder: (context, snapshot) {
            if (snapshot.hasError) {
              final isAuthError = snapshot.error is AuthException;
              final isParseError = snapshot.error is DocumentsParseException;
              return Center(
                child: Padding(
                  padding: const EdgeInsets.all(32),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        isAuthError
                            ? Icons.lock_outline_rounded
                            : Icons.error_outline_rounded,
                        size: 56,
                        color: TruxifyColors.error,
                      ),
                      const SizedBox(height: 16),
                      Text(
                        isAuthError
                            ? 'Session Expired'
                            : isParseError
                                ? 'Could Not Read Documents'
                                : 'Could Not Load Documents',
                        style: GoogleFonts.dmSans(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: TruxifyColors.primaryText,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        isAuthError
                            ? 'Please log in again to view your documents.'
                            : isParseError
                                ? 'We had trouble reading your documents. Please try again later.'
                                : 'Something went wrong. Please try again later.',
                        style: GoogleFonts.dmSans(
                          fontSize: 13,
                          color: TruxifyColors.secondaryText,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      if (isAuthError) ...[
                        const SizedBox(height: 24),
                        PrimaryButton(
                          label: 'Go to Login',
                          onPressed: () => Navigator.of(context)
                              .pushReplacementNamed('/login'),
                        ),
                      ],
                    ],
                  ),
                ),
              );
            }

            if (!snapshot.hasData) {
              return const Center(child: CircularProgressIndicator());
            }

            final documents = snapshot.data!;

            if (documents.isEmpty) {
              return Center(
                child: Padding(
                  padding: const EdgeInsets.all(32),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.folder_open_rounded,
                          size: 56, color: TruxifyColors.hintText),
                      const SizedBox(height: 16),
                      Text(
                        'No Documents Yet',
                        style: GoogleFonts.dmSans(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: TruxifyColors.primaryText,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Upload your RC Book, Driving Licence, or other documents to get started.',
                        style: GoogleFonts.dmSans(
                          fontSize: 13,
                          color: TruxifyColors.secondaryText,
                        ),
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ),
                ),
              );
            }

            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
              children: [
                _buildDigilockerVerificationCard(context),
                ...documents.map((document) {
                  final isWarning = document.statusTone == 'warning';
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 14),
                    child: AppCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Expanded(
                                child: Text(
                                  document.title,
                                  style: GoogleFonts.dmSans(
                                    fontSize: 16,
                                    fontWeight: FontWeight.bold,
                                    color: TruxifyColors.primaryText,
                                  ),
                                ),
                              ),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 8, vertical: 4),
                                decoration: BoxDecoration(
                                  color: isWarning
                                      ? TruxifyColors.warningLight
                                      : (document.isGovtVerified
                                          ? Colors.green.shade50
                                          : Colors.orange.shade50),
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: Text(
                                  isWarning
                                      ? 'Expiring Soon'
                                      : (document.isGovtVerified
                                          ? '✓ Govt Verified'
                                          : 'Self-Uploaded (Unverified)'),
                                  style: GoogleFonts.dmSans(
                                    fontSize: 10,
                                    fontWeight: FontWeight.bold,
                                    color: isWarning
                                        ? TruxifyColors.warning
                                        : (document.isGovtVerified
                                            ? Colors.green.shade800
                                            : Colors.orange.shade800),
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 6),
                          Text(
                            document.subtitle,
                            style: GoogleFonts.dmSans(
                              fontSize: 12,
                              color: TruxifyColors.secondaryText,
                            ),
                          ),
                          const SizedBox(height: 12),
                          const Divider(height: 1, color: TruxifyColors.border),
                          const SizedBox(height: 12),
                          _DocLine(
                              label: document.statusLabel,
                              value: document.docNumber,
                              isMonospace: true),
                          _DocLine(
                              label: 'Last verified',
                              value: document.lastVerified),
                          _DocLine(
                              label: 'Valid until',
                              value: document.validUntil,
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
                                  onPressed: () => _showDocumentPreviewSheet(
                                    context,
                                    document.title,
                                    document.docNumber,
                                    document.lastVerified,
                                    document.validUntil,
                                    isWarning,
                                  ),
                                  child: Text(
                                    'View',
                                    style: GoogleFonts.dmSans(
                                      fontWeight: FontWeight.bold,
                                      color: TruxifyColors.secondaryText,
                                    ),
                                  ),
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: PrimaryButton(
                                  label: isWarning ? 'Renew Now' : 'Re-verify',
                                  onPressed: () {
                                    if (isWarning) {
                                      _simulateUpload(context, document.title);
                                    } else {
                                      ScaffoldMessenger.of(context)
                                          .showSnackBar(
                                        SnackBar(
                                          content: Text(
                                              '${document.title} re-verification request sent to RTO Node.'),
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

                // Upload card
                GestureDetector(
                  onTap: () => _showUploadSheet(context),
                  child: Container(
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                          color: TruxifyColors.accent.withValues(alpha: 0.3),
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
                              color: TruxifyColors.hintText,
                            ),
                            textAlign: TextAlign.center,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            );
          },
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
              color: TruxifyColors.secondaryText,
            ),
          ),
          Text(
            value,
            style: isMonospace
                ? GoogleFonts.robotoMono(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    color: TruxifyColors.primaryText,
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
