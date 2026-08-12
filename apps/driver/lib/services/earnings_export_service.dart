import 'dart:io';
import 'dart:typed_data';

import 'package:path_provider/path_provider.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:share_plus/share_plus.dart';

import '../models/earnings_statement_model.dart';

typedef ShareXFilesFunction = Future<void> Function(List<XFile> files, {String? text});

class EarningsExportService {
  static const String _tempFilePrefix = 'earnings_export_';
  static const Duration _staleThreshold = Duration(minutes: 10);

  final ShareXFilesFunction _shareXFiles;

  EarningsExportService({
    ShareXFilesFunction? shareXFiles,
  }) : _shareXFiles = shareXFiles ?? _defaultShareXFiles;

  static Future<void> _defaultShareXFiles(List<XFile> files, {String? text}) async {
    await Share.shareXFiles(files, text: text);
  }

  /// Cleans up stale earnings export temporary files in [tempDir].
  ///
  /// Only deletes files matching [_tempFilePrefix] or 'earnings_export' that are older
  /// than [_staleThreshold] relative to [now]. Unrelated files remain untouched.
  Future<void> cleanOldExports({DateTime? now, Directory? customTempDir}) async {
    try {
      final tempDir = customTempDir ?? Directory.systemTemp;
      if (!await tempDir.exists()) return;

      final currentTime = now ?? DateTime.now();
      final entities = tempDir.listSync();

      for (final entity in entities) {
        if (entity is File) {
          final filename = entity.path.split(Platform.pathSeparator).last;
          if (filename.startsWith(_tempFilePrefix)) {
            try {
              final lastModified = await entity.lastModified();
              if (currentTime.difference(lastModified) > _staleThreshold) {
                await entity.delete().catchError((_) {});
              }
            } catch (_) {
              // Ignore individual file access errors
            }
          }
        }
      }
    } catch (_) {
      // Best-effort cleanup: ignore directory listing errors
    }
  }

  Future<void> shareCsv(
    String csvContent,
    String filename, {
    Directory? customTempDir,
    Duration? cleanupDelay,
  }) async {
    // 1. Clean up stale export files before creating a new one (best-effort)
    await cleanOldExports(customTempDir: customTempDir).catchError((_) {});

    final tempDir = customTempDir ?? Directory.systemTemp;
    final safeFilename = filename.startsWith(_tempFilePrefix)
        ? filename
        : '$_tempFilePrefix$filename';
    final file = File('${tempDir.path}${Platform.pathSeparator}$safeFilename');

    // 2. Write CSV to temporary file
    try {
      await file.writeAsString(csvContent);
    } catch (e) {
      // If write fails, delete file if created and rethrow original error
      await file.delete().catchError((_) {});
      rethrow;
    }

    // 3. Share temporary file
    try {
      await _shareXFiles([XFile(file.path)], text: 'Earnings Statement');
    } catch (e) {
      // If share invocation throws prior to/during presentation, clean up immediately and rethrow
      await file.delete().catchError((_) {});
      rethrow;
    }

    // 4. Successful share: do NOT delete immediately in a finally block.
    // Schedule deferred cleanup so the receiving app has sufficient time to consume the file.
    _scheduleFileCleanup(file, delay: cleanupDelay ?? _staleThreshold);
  }

  void _scheduleFileCleanup(File file, {required Duration delay}) {
    Future.delayed(delay, () async {
      try {
        if (await file.exists()) {
          await file.delete();
        }
      } catch (_) {}
    });
  }

  Future<String> saveCsv(String csvContent, String filename) async {
    final dir = await getApplicationDocumentsDirectory();
    final file = File('${dir.path}/$filename');
    await file.writeAsString(csvContent);
    return file.path;
  }

  Future<Uint8List> generatePdf(EarningsStatementModel statement) async {
    final pdf = pw.Document();
    final theme = _buildTheme();

    pdf.addPage(
      pw.MultiPage(
        pageTheme: _buildPageTheme(theme),
        header: (context) => _buildHeader(statement),
        footer: (context) => _buildFooter(),
        build: (context) => [
          _buildDateRangeSection(statement),
          pw.SizedBox(height: 16),
          _buildSummarySection(statement),
          pw.SizedBox(height: 24),
          _buildTripsSection(statement),
        ],
      ),
    );

    return pdf.save();
  }

  Future<void> sharePdf(EarningsStatementModel statement) async {
    final pdfBytes = await generatePdf(statement);
    await Printing.sharePdf(
      bytes: pdfBytes,
      filename: 'earnings_statement_${_dateLabel(statement)}.pdf',
    );
  }

  Future<void> printPdf(EarningsStatementModel statement) async {
    final pdfBytes = await generatePdf(statement);
    await Printing.layoutPdf(
      onLayout: (_) => pdfBytes,
    );
  }

  static String _dateLabel(EarningsStatementModel s) {
    final start = '${s.startDate.year}-${s.startDate.month.toString().padLeft(2, '0')}-${s.startDate.day.toString().padLeft(2, '0')}';
    final end = '${s.endDate.year}-${s.endDate.month.toString().padLeft(2, '0')}-${s.endDate.day.toString().padLeft(2, '0')}';
    return '$start-$end';
  }

  pw.ThemeData _buildTheme() {
    return pw.ThemeData.withFont(
      base: pw.Font.helvetica(),
      bold: pw.Font.helveticaBold(),
    );
  }

  pw.PageTheme _buildPageTheme(pw.ThemeData theme) {
    return pw.PageTheme(
      theme: theme,
      margin: const pw.EdgeInsets.all(36),
      buildBackground: (context) => pw.FullPage(
        ignoreMargins: true,
        child: pw.Container(
          decoration: pw.BoxDecoration(
            border: pw.Border.all(color: PdfColors.blue100, width: 1),
          ),
        ),
      ),
    );
  }

  pw.Widget _buildHeader(EarningsStatementModel statement) {
    return pw.Column(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        pw.Row(
          mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
          children: [
            pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                pw.Text('TRUXIFY', style: pw.TextStyle(
                  fontSize: 24,
                  fontWeight: pw.FontWeight.bold,
                  color: PdfColors.blue800,
                  letterSpacing: 2,
                )),
                pw.Text('Earnings Statement',
                    style: pw.TextStyle(fontSize: 14, color: PdfColors.grey600)),
              ],
            ),
            pw.Container(
              padding: const pw.EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: pw.BoxDecoration(
                color: PdfColors.blue50,
                borderRadius: const pw.BorderRadius.all(pw.Radius.circular(4)),
              ),
              child: pw.Text('DRIVER COPY',
                  style: pw.TextStyle(fontSize: 10, color: PdfColors.blue800, fontWeight: pw.FontWeight.bold)),
            ),
          ],
        ),
        pw.SizedBox(height: 8),
        pw.Container(height: 2, color: PdfColors.blue200),
        pw.SizedBox(height: 12),
        pw.Row(
          children: [
            pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                pw.Text('Driver: ${statement.driverName}',
                    style: pw.TextStyle(fontSize: 12, fontWeight: pw.FontWeight.bold)),
                if (statement.driverPhone != null)
                  pw.Text('Phone: ${statement.driverPhone}',
                      style: pw.TextStyle(fontSize: 10, color: PdfColors.grey600)),
              ],
            ),
          ],
        ),
        pw.SizedBox(height: 8),
      ],
    );
  }

  pw.Widget _buildFooter() {
    return pw.Container(
      margin: const pw.EdgeInsets.only(top: 8),
      child: pw.Row(
        mainAxisAlignment: pw.MainAxisAlignment.center,
        children: [
          pw.Text(
            'Generated by Truxify',
            style: pw.TextStyle(fontSize: 8, color: PdfColors.grey400),
          ),
        ],
      ),
    );
  }

  pw.Widget _buildDateRangeSection(EarningsStatementModel statement) {
    return pw.Container(
      padding: const pw.EdgeInsets.all(12),
      decoration: pw.BoxDecoration(
        color: PdfColors.grey50,
        borderRadius: const pw.BorderRadius.all(pw.Radius.circular(4)),
      ),
      child: pw.Row(
        mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
        children: [
          _dateChip('FROM', statement.startDate),
          pw.Text('->', style: pw.TextStyle(color: PdfColors.blue400, fontSize: 14)),
          _dateChip('TO', statement.endDate),
        ],
      ),
    );
  }

  pw.Widget _dateChip(String label, DateTime date) {
    final months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return pw.Column(
      children: [
        pw.Text(label, style: pw.TextStyle(fontSize: 9, color: PdfColors.grey500, fontWeight: pw.FontWeight.bold)),
        pw.SizedBox(height: 4),
        pw.Text('${date.day} ${months[date.month - 1]} ${date.year}',
            style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold)),
      ],
    );
  }

  pw.Widget _buildSummarySection(EarningsStatementModel statement) {
    return pw.Container(
      padding: const pw.EdgeInsets.all(16),
      decoration: pw.BoxDecoration(
        color: PdfColors.blue50,
        borderRadius: const pw.BorderRadius.all(pw.Radius.circular(8)),
      ),
      child: pw.Column(
        children: [
          pw.Row(
            mainAxisAlignment: pw.MainAxisAlignment.spaceAround,
            children: [
              _summaryItem('Total Trips', '${statement.totalTrips}', PdfColors.blue700),
              _summaryItem('Total Earnings',
                  '₹${statement.totalEarnings.toStringAsFixed(0)}', PdfColors.green700),
            ],
          ),
          pw.SizedBox(height: 12),
          pw.Row(
            mainAxisAlignment: pw.MainAxisAlignment.spaceAround,
            children: [
              _summaryItem('Platform Fees',
                  '₹${statement.platformFees.toStringAsFixed(0)}', PdfColors.orange700),
              _summaryItem('Net Earnings',
                  '₹${statement.netEarnings.toStringAsFixed(0)}', PdfColors.green800),
            ],
          ),
        ],
      ),
    );
  }

  pw.Widget _summaryItem(String label, String value, PdfColor color) {
    return pw.Column(
      children: [
        pw.Text(value,
            style: pw.TextStyle(
                fontSize: 18, fontWeight: pw.FontWeight.bold, color: color)),
        pw.SizedBox(height: 4),
        pw.Text(label,
            style: pw.TextStyle(fontSize: 10, color: PdfColors.grey600)),
      ],
    );
  }

  pw.Widget _buildTripsSection(EarningsStatementModel statement) {
    if (statement.trips.isEmpty) {
      return pw.Container(
        padding: const pw.EdgeInsets.all(16),
        child: pw.Center(
          child: pw.Text('No trips found in this period.',
              style: pw.TextStyle(fontSize: 12, color: PdfColors.grey500)),
        ),
      );
    }

    return pw.Column(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        pw.Text('Trip-wise Earnings',
            style: pw.TextStyle(
                fontSize: 14, fontWeight: pw.FontWeight.bold, color: PdfColors.grey800)),
        pw.SizedBox(height: 8),
        pw.Table(
          border: pw.TableBorder.all(color: PdfColors.grey300, width: 0.5),
          columnWidths: {
            0: const pw.FlexColumnWidth(1.5),
            1: const pw.FlexColumnWidth(3),
            2: const pw.FlexColumnWidth(2),
            3: const pw.FlexColumnWidth(1.5),
          },
          children: [
            pw.TableRow(
              decoration: const pw.BoxDecoration(color: PdfColors.grey100),
              children: [
                _tableHeader('Date'),
                _tableHeader('Route'),
                _tableHeader('Customer'),
                _tableHeader('Amount'),
              ],
            ),
            ...statement.trips.map((trip) => pw.TableRow(
                  children: [
                    _tableCell(trip.tripDate != null
                        ? '${trip.tripDate!.day}/${trip.tripDate!.month}'
                        : '-'),
                    _tableCell(trip.route ?? '-'),
                    _tableCell(trip.customerName ?? '-'),
                    _tableCell('₹${trip.earnings.toStringAsFixed(0)}',
                        bold: true),
                  ],
                )),
          ],
        ),
      ],
    );
  }

  pw.Widget _tableHeader(String text) {
    return pw.Container(
      padding: const pw.EdgeInsets.all(8),
      child: pw.Text(text,
          style: pw.TextStyle(
              fontSize: 10,
              fontWeight: pw.FontWeight.bold,
              color: PdfColors.grey700)),
    );
  }

  pw.Widget _tableCell(String text, {bool bold = false}) {
    return pw.Container(
      padding: const pw.EdgeInsets.all(8),
      child: pw.Text(text,
          style: pw.TextStyle(
              fontSize: 10,
              fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal)),
    );
  }
}
