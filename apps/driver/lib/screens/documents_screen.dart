import 'dart:async';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../data/mock_data.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';

class DocumentsScreen extends StatefulWidget {
  const DocumentsScreen({super.key});

  @override
  State<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends State<DocumentsScreen> {
  String? _selectedUploadType;

  Future<void> _simulateUpload(BuildContext context, String docType) async {
    double progress = 0.0;
    String statusText = 'Reading file contents...';
    bool isDone = false;

    await showModalBottomSheet<void>(
      context: context,
      isDismissible: false,
      enableDrag: false,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            // Start a timer to increment progress
            if (progress == 0.0) {
              Timer.periodic(const Duration(milliseconds: 300), (timer) {
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
                    // Complete after verification delay
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
    );
  }

  Future<void> _showUploadSheet(BuildContext context) async {
    String selectedType = _selectedUploadType ?? 'RC Book';
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
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
                              color: isSelected ? TruxifyColors.accentLight : Colors.grey.shade50,
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(
                                color: isSelected ? TruxifyColors.accent : Colors.grey.shade200,
                              ),
                            ),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  type,
                                  style: GoogleFonts.dmSans(
                                    fontSize: 14,
                                    fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                                    color: TruxifyColors.primaryText,
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
      backgroundColor: Colors.white,
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
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: isWarning ? TruxifyColors.warningLight : TruxifyColors.successLight,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      isWarning ? 'EXPIRING' : 'VERIFIED',
                      style: GoogleFonts.dmSans(
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                        color: isWarning ? TruxifyColors.warning : TruxifyColors.success,
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
                      isWarning ? Icons.warning_amber_rounded : Icons.verified_user_rounded,
                      color: isWarning ? TruxifyColors.warning : TruxifyColors.success,
                      size: 48,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Document Status',
                      style: GoogleFonts.dmSans(fontSize: 13, fontWeight: FontWeight.bold, color: TruxifyColors.primaryText),
                    ),
                    const SizedBox(height: 20),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Document ID:', style: GoogleFonts.dmSans(fontSize: 12, color: TruxifyColors.hintText)),
                        Text(docNumber, style: GoogleFonts.robotoMono(fontSize: 11, fontWeight: FontWeight.bold, color: TruxifyColors.primaryText)),
                      ],
                    ),
                    const Divider(height: 16, color: TruxifyColors.border),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Last Verified:', style: GoogleFonts.dmSans(fontSize: 12, color: TruxifyColors.hintText)),
                        Text(lastVerified, style: GoogleFonts.dmSans(fontSize: 12, fontWeight: FontWeight.bold, color: TruxifyColors.primaryText)),
                      ],
                    ),
                    const Divider(height: 16, color: TruxifyColors.border),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Valid Until:', style: GoogleFonts.dmSans(fontSize: 12, color: TruxifyColors.hintText)),
                        Text(validUntil, style: GoogleFonts.dmSans(fontSize: 12, fontWeight: FontWeight.bold, color: isWarning ? TruxifyColors.warning : TruxifyColors.primaryText)),
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
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
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
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded, color: TruxifyColors.primaryText),
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
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
          children: [
            ...documentRecords.map((document) {
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
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: isWarning ? TruxifyColors.warningLight : TruxifyColors.accentLight,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Text(
                              isWarning ? 'Expiring Soon' : 'Verified',
                              style: GoogleFonts.dmSans(
                                fontSize: 10,
                                fontWeight: FontWeight.bold,
                                color: isWarning ? TruxifyColors.warning : TruxifyColors.accentDark,
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
                      _DocLine(label: document.statusLabel, value: document.docNumber, isMonospace: true),
                      _DocLine(label: 'Last verified', value: document.lastVerified),
                      _DocLine(label: 'Valid until', value: document.validUntil, isWarning: isWarning),
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton(
                              style: OutlinedButton.styleFrom(
                                padding: const EdgeInsets.symmetric(vertical: 12),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                                side: const BorderSide(color: TruxifyColors.border),
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
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(
                                      content: Text('${document.title} re-verification request sent to RTO Node.'),
                                      backgroundColor: TruxifyColors.success,
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
            GestureDetector(
              onTap: () => _showUploadSheet(context),
              child: Container(
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: TruxifyColors.accent.withOpacity(0.3), style: BorderStyle.solid),
                ),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 28, horizontal: 16),
                  child: Column(
                    children: [
                      const Icon(Icons.cloud_upload_outlined, color: TruxifyColors.accent, size: 36),
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
                    color: isWarning ? TruxifyColors.warning : TruxifyColors.primaryText,
                  ),
          ),
        ],
      ),
    );
  }
}
