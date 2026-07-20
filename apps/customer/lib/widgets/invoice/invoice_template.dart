import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:qr/qr.dart' as qr;

/// Brand colours matching Truxify theme.
class _InvoiceColors {
  static const accent = PdfColor.fromInt(0xFF00897B);
  static const accentDark = PdfColor.fromInt(0xFF00695C);
  static const accentLight = PdfColor.fromInt(0xFFE0F2F1);
  static const primaryText = PdfColor.fromInt(0xFF1A1A1A);
  static const secondaryText = PdfColor.fromInt(0xFF6B6B6B);
  static const divider = PdfColor.fromInt(0xFFE0E0E0);
  static const white = PdfColors.white;
  static const background = PdfColor.fromInt(0xFFF5F5F5);
}

/// Data class carrying every value the PDF template needs.
class InvoiceData {
  const InvoiceData({
    required this.orderId,
    required this.date,
    required this.status,
    required this.pickupAddress,
    required this.dropAddress,
    required this.driverName,
    required this.truckNumber,
    this.driverPhone,
    this.baseFare,
    this.distanceCharge,
    this.tollCharge,
    this.platformFee,
    required this.total,
    this.blockchainTxHash,
  });

  final String orderId;
  final String date;
  final String status;
  final String pickupAddress;
  final String dropAddress;
  final String driverName;
  final String truckNumber;
  final String? driverPhone;
  final String? baseFare;
  final String? distanceCharge;
  final String? tollCharge;
  final String? platformFee;
  final String total;
  final String? blockchainTxHash;
}

/// Builds a single-page A4 PDF invoice from [data].
pw.Document buildInvoicePdf(InvoiceData data) {
  final pdf = pw.Document();

  pdf.addPage(
    pw.MultiPage(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.symmetric(horizontal: 40, vertical: 36),
      header: (_) => _buildHeader(data),
      footer: (_) => _buildFooter(),
      build: (_) => [
        _buildOrderMeta(data),
        pw.SizedBox(height: 18),
        _buildRouteSection(data),
        pw.SizedBox(height: 18),
        _buildDriverSection(data),
        pw.SizedBox(height: 18),
        _buildPriceSection(data),
        pw.SizedBox(height: 18),
        if (data.blockchainTxHash != null && data.blockchainTxHash!.isNotEmpty)
          _buildBlockchainSection(data),
      ],
    ),
  );

  return pdf;
}

// ── Header ──────────────────────────────────────────────────────────────────

pw.Widget _buildHeader(InvoiceData data) => pw.Column(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        pw.Row(
          mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
          children: [
            pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                pw.Text(
                  'TRUXIFY',
                  style: pw.TextStyle(
                    fontSize: 26,
                    fontWeight: pw.FontWeight.bold,
                    color: _InvoiceColors.accent,
                    letterSpacing: 2,
                  ),
                ),
                pw.SizedBox(height: 2),
                pw.Text(
                  'Logistics Invoice',
                  style: pw.TextStyle(
                    fontSize: 12,
                    color: _InvoiceColors.secondaryText,
                  ),
                ),
              ],
            ),
            pw.Container(
              padding: const pw.EdgeInsets.symmetric(horizontal: 14, vertical: 6),
              decoration: pw.BoxDecoration(
                color: _InvoiceColors.accentLight,
                borderRadius: pw.BorderRadius.circular(6),
              ),
              child: pw.Text(
                data.status.toUpperCase(),
                style: pw.TextStyle(
                  fontSize: 11,
                  fontWeight: pw.FontWeight.bold,
                  color: _InvoiceColors.accentDark,
                ),
              ),
            ),
          ],
        ),
        pw.SizedBox(height: 10),
        pw.Container(height: 2, color: _InvoiceColors.accent),
      ],
    );

// ── Order meta ──────────────────────────────────────────────────────────────

pw.Widget _buildOrderMeta(InvoiceData data) {
  final now = DateTime.now();
  final generatedDate = '${now.day.toString().padLeft(2, '0')}/${now.month.toString().padLeft(2, '0')}/${now.year}';

  return pw.Column(
    crossAxisAlignment: pw.CrossAxisAlignment.start,
    children: [
      _sectionTitle('Order Details'),
      pw.SizedBox(height: 8),
      _twoColumnRow('Order ID', data.orderId),
      _twoColumnRow('Order Date', data.date),
      _twoColumnRow('Invoice Date', generatedDate),
    ],
  );
}

// ── Route ───────────────────────────────────────────────────────────────────

pw.Widget _buildRouteSection(InvoiceData data) => pw.Column(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        _sectionTitle('Route'),
        pw.SizedBox(height: 8),
        _addressRow('Pickup', data.pickupAddress),
        pw.SizedBox(height: 6),
        _addressRow('Drop-off', data.dropAddress),
      ],
    );

// ── Driver ──────────────────────────────────────────────────────────────────

pw.Widget _buildDriverSection(InvoiceData data) => pw.Column(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        _sectionTitle('Driver Details'),
        pw.SizedBox(height: 8),
        _twoColumnRow('Name', data.driverName),
        _twoColumnRow('Vehicle', data.truckNumber),
        if (data.driverPhone != null && data.driverPhone!.isNotEmpty)
          _twoColumnRow('Phone', data.driverPhone!),
      ],
    );

// ── Price breakdown ─────────────────────────────────────────────────────────

pw.Widget _buildPriceSection(InvoiceData data) => pw.Column(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        _sectionTitle('Price Breakdown'),
        pw.SizedBox(height: 8),
        pw.Container(
          padding: const pw.EdgeInsets.all(14),
          decoration: pw.BoxDecoration(
            color: _InvoiceColors.background,
            borderRadius: pw.BorderRadius.circular(8),
          ),
          child: pw.Column(
            children: [
              if (data.baseFare != null)
                _priceLine('Base Fare', data.baseFare!),
              if (data.distanceCharge != null)
                _priceLine('Distance Charge', data.distanceCharge!),
              if (data.tollCharge != null)
                _priceLine('Toll Charges', data.tollCharge!),
              if (data.platformFee != null)
                _priceLine('Platform Fee', data.platformFee!),
              pw.Divider(color: _InvoiceColors.divider, height: 16),
              _priceLine('Total', data.total, isBold: true),
            ],
          ),
        ),
      ],
    );

// ── Blockchain ──────────────────────────────────────────────────────────────

pw.Widget _buildBlockchainSection(InvoiceData data) => pw.Column(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        _sectionTitle('Blockchain Verification'),
        pw.SizedBox(height: 8),
        pw.Container(
          width: double.infinity,
          padding: const pw.EdgeInsets.all(12),
          decoration: pw.BoxDecoration(
            color: _InvoiceColors.accentLight,
            borderRadius: pw.BorderRadius.circular(8),
          ),
          child: pw.Row(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              pw.Expanded(
                child: pw.Column(
                  crossAxisAlignment: pw.CrossAxisAlignment.start,
                  children: [
                    pw.Text(
                      'Transaction Hash',
                      style: pw.TextStyle(
                        fontSize: 9,
                        fontWeight: pw.FontWeight.bold,
                        color: _InvoiceColors.accentDark,
                      ),
                    ),
                    pw.SizedBox(height: 4),
                    pw.Text(
                      data.blockchainTxHash!,
                      style: pw.TextStyle(
                        fontSize: 8,
                        color: _InvoiceColors.primaryText,
                      ),
                    ),
                  ],
                ),
              ),
              pw.SizedBox(width: 12),
              _buildQrCode(data.blockchainTxHash!),
            ],
          ),
        ),
      ],
    );

pw.Widget _buildQrCode(String data) {
  final qrCode = qr.QrCode.fromData(
    data: data,
    errorCorrectLevel: qr.QrErrorCorrectLevel.M,
  );
  final qrImage = qr.QrImage(qrCode);
  final moduleCount = qrImage.moduleCount;
  const size = 64.0;
  final moduleSize = size / moduleCount;

  final modules = <pw.Widget>[];
  for (var row = 0; row < moduleCount; row++) {
    final cells = <pw.Widget>[];
    for (var col = 0; col < moduleCount; col++) {
      final isDark = qrImage.isDark(row, col);
      cells.add(
        pw.Container(
          width: moduleSize,
          height: moduleSize,
          color: isDark ? _InvoiceColors.primaryText : _InvoiceColors.white,
        ),
      );
    }
    modules.add(pw.Row(mainAxisSize: pw.MainAxisSize.min, children: cells));
  }

  return pw.Container(
    width: size,
    height: size,
    decoration: pw.BoxDecoration(
      color: _InvoiceColors.white,
      border: pw.Border.all(color: _InvoiceColors.divider, width: 0.5),
    ),
    child: pw.Column(mainAxisSize: pw.MainAxisSize.min, children: modules),
  );
}

// ── Footer ──────────────────────────────────────────────────────────────────

pw.Widget _buildFooter() => pw.Column(
      children: [
        pw.Container(height: 1, color: _InvoiceColors.divider),
        pw.SizedBox(height: 10),
        pw.Text(
          'Thank you for using Truxify.',
          style: pw.TextStyle(
            fontSize: 10,
            color: _InvoiceColors.secondaryText,
          ),
        ),
        pw.SizedBox(height: 2),
        pw.Text(
          'This is a system-generated invoice and does not require a signature.',
          style: pw.TextStyle(
            fontSize: 8,
            color: _InvoiceColors.secondaryText,
          ),
        ),
      ],
    );

// ── Shared helpers ──────────────────────────────────────────────────────────

pw.Widget _sectionTitle(String text) => pw.Container(
      padding: const pw.EdgeInsets.only(bottom: 4),
      decoration: pw.BoxDecoration(
        border: pw.Border(
          bottom: pw.BorderSide(color: _InvoiceColors.accent, width: 1.5),
        ),
      ),
      child: pw.Text(
        text,
        style: pw.TextStyle(
          fontSize: 13,
          fontWeight: pw.FontWeight.bold,
          color: _InvoiceColors.accentDark,
        ),
      ),
    );

pw.Widget _twoColumnRow(String label, String value) => pw.Padding(
      padding: const pw.EdgeInsets.only(bottom: 4),
      child: pw.Row(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          pw.SizedBox(
            width: 120,
            child: pw.Text(
              label,
              style: pw.TextStyle(
                fontSize: 10,
                color: _InvoiceColors.secondaryText,
              ),
            ),
          ),
          pw.Expanded(
            child: pw.Text(
              value,
              style: pw.TextStyle(
                fontSize: 10,
                fontWeight: pw.FontWeight.bold,
                color: _InvoiceColors.primaryText,
              ),
            ),
          ),
        ],
      ),
    );

pw.Widget _addressRow(String label, String address) => pw.Row(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        pw.Container(
          width: 8,
          height: 8,
          margin: const pw.EdgeInsets.only(top: 3, right: 8),
          decoration: pw.BoxDecoration(
            color: _InvoiceColors.accent,
            shape: pw.BoxShape.circle,
          ),
        ),
        pw.Expanded(
          child: pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              pw.Text(
                label,
                style: pw.TextStyle(
                  fontSize: 9,
                  fontWeight: pw.FontWeight.bold,
                  color: _InvoiceColors.accentDark,
                ),
              ),
              pw.SizedBox(height: 1),
              pw.Text(
                address,
                style: pw.TextStyle(
                  fontSize: 10,
                  color: _InvoiceColors.primaryText,
                ),
              ),
            ],
          ),
        ),
      ],
    );

pw.Widget _priceLine(String label, String amount, {bool isBold = false}) =>
    pw.Padding(
      padding: const pw.EdgeInsets.only(bottom: 6),
      child: pw.Row(
        children: [
          pw.Text(
            label,
            style: pw.TextStyle(
              fontSize: 10,
              fontWeight: isBold ? pw.FontWeight.bold : pw.FontWeight.normal,
              color: isBold
                  ? _InvoiceColors.primaryText
                  : _InvoiceColors.secondaryText,
            ),
          ),
          pw.Spacer(),
          pw.Text(
            amount,
            style: pw.TextStyle(
              fontSize: 10,
              fontWeight: isBold ? pw.FontWeight.bold : pw.FontWeight.w600,
              color: isBold
                  ? _InvoiceColors.accentDark
                  : _InvoiceColors.primaryText,
            ),
          ),
        ],
      ),
    );
