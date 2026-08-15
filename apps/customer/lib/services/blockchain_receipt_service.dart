import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:qr/qr.dart' as qr;
import '../core/api_client.dart';
import '../theme/app_theme.dart';

class BlockchainReceiptService {
  static final _apiClient = ApiClient();

  static Future<void> showReceipt(BuildContext context, String orderDisplayId) async {
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (BuildContext context) {
        return const Center(
          child: CircularProgressIndicator(
            valueColor: AlwaysStoppedAnimation<Color>(TruxifyColors.accent),
          ),
        );
      },
    );

    try {
      final response = await _apiClient.get(
        '/api/blockchain/receipt/${Uri.encodeComponent(orderDisplayId)}',
      ) as Map<String, dynamic>?;

      if (!context.mounted) return;
      Navigator.of(context).pop(); // dismiss loading

      if (response == null) {
        throw Exception('Empty response from blockchain service');
      }

      _showReceiptModal(context, response);
    } catch (e) {
      if (!context.mounted) return;
      Navigator.of(context).pop(); // dismiss loading
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to load on-chain receipt: ${e.toString().replaceAll('Exception: ', '')}'),
          backgroundColor: TruxifyColors.error,
        ),
      );
    }
  }

  static void _showReceiptModal(BuildContext context, Map<String, dynamic> data) {
    final orderId = data['orderId']?.toString() ?? '—';
    final origin = data['origin']?.toString() ?? '—';
    final destination = data['destination']?.toString() ?? '—';
    final rawPrice = data['price'] ?? 0;
    final priceStr = rawPrice is num
        ? '₹ ${(rawPrice / 100).toStringAsFixed(2)}'
        : rawPrice.toString();
    final driver = data['driver']?.toString() ?? '—';
    final timestamp = data['timestamp']?.toString() ?? '—';
    final txHash = data['txHash']?.toString() ?? '';

    final shortenedDriver = driver.length > 10
        ? '${driver.substring(0, 6)}...${driver.substring(driver.length - 4)}'
        : driver;
    final shortenedTx = txHash.length > 12
        ? '${txHash.substring(0, 8)}...${txHash.substring(txHash.length - 6)}'
        : txHash;

    final polygonscanUrl = txHash.isNotEmpty && txHash != '0x0000000000000000000000000000000000000000000000000000000000000000'
        ? 'https://polygonscan.com/tx/$txHash'
        : null;

    showDialog<void>(
      context: context,
      builder: (BuildContext context) {
        return Dialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          backgroundColor: Theme.of(context).cardColor,
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    const Icon(Icons.verified_user_rounded, color: TruxifyColors.accent, size: 28),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'On-Chain Receipt',
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                              fontWeight: FontWeight.w800,
                            ),
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close),
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                  ],
                ),
                const Divider(height: 24),
                _buildReceiptRow(context, 'Trip ID', orderId),
                _buildReceiptRow(context, 'Origin', origin),
                _buildReceiptRow(context, 'Destination', destination),
                _buildReceiptRow(context, 'Amount Paid', priceStr, isBoldValue: true),
                _buildReceiptRow(
                  context,
                  'Driver Wallet',
                  shortenedDriver,
                  action: IconButton(
                    icon: const Icon(Icons.copy_rounded, size: 18),
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: driver));
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Driver wallet address copied to clipboard')),
                      );
                    },
                  ),
                ),
                _buildReceiptRow(
                  context,
                  'Tx Hash',
                  shortenedTx,
                  action: polygonscanUrl != null
                      ? IconButton(
                          icon: const Icon(Icons.open_in_new_rounded, size: 18, color: TruxifyColors.accent),
                          onPressed: () => launchUrl(Uri.parse(polygonscanUrl)),
                        )
                      : null,
                ),
                _buildReceiptRow(context, 'Timestamp', timestamp),
                const SizedBox(height: 16),
                Center(
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: Colors.grey.shade300),
                    ),
                    child: CustomPaint(
                      size: const Size(120, 120),
                      painter: QrCodePainter(polygonscanUrl ?? 'https://polygonscan.com'),
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                const Center(
                  child: Text(
                    'Scan to verify receipt immutability',
                    style: TextStyle(fontSize: 11, color: Colors.grey),
                  ),
                ),
                const SizedBox(height: 24),
                ElevatedButton.icon(
                  onPressed: () => _generatePdf(orderId, origin, destination, priceStr, driver, txHash, timestamp),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: TruxifyColors.accent,
                    foregroundColor: Colors.white,
                    minimumSize: const Size(0, 48),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  icon: const Icon(Icons.download_rounded),
                  label: const Text('Download PDF Receipt', style: TextStyle(fontWeight: FontWeight.bold)),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  static Widget _buildReceiptRow(BuildContext context, String label, String value, {bool isBoldValue = false, Widget? action}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 100,
            child: Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: Colors.grey.shade600,
              ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                fontSize: 14,
                fontWeight: isBoldValue ? FontWeight.bold : FontWeight.normal,
                color: isBoldValue ? TruxifyColors.accentDark : null,
              ),
            ),
          ),
          if (action != null) action,
        ],
      ),
    );
  }

  static Future<void> _generatePdf(
    String orderId,
    String origin,
    String destination,
    String priceStr,
    String driver,
    String txHash,
    String timestamp,
  ) async {
    final pdf = pw.Document();

    pdf.addPage(
      pw.Page(
        pageFormat: PdfPageFormat.a4,
        build: (pw.Context context) {
          return pw.Padding(
            padding: const pw.EdgeInsets.all(32),
            child: pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                pw.Text(
                  'TRUXIFY ON-CHAIN DELIVERY RECEIPT',
                  style: pw.TextStyle(
                    fontSize: 22,
                    fontWeight: pw.FontWeight.bold,
                    color: PdfColor.fromInt(0xFF00897B),
                  ),
                ),
                pw.SizedBox(height: 8),
                pw.Text(
                  'This is an immutable delivery record fetched from the Polygon Smart Contract.',
                  style: const pw.TextStyle(fontSize: 10, color: PdfColors.grey600),
                ),
                pw.Divider(height: 32, thickness: 1.5),
                _buildPdfRow('Trip ID / Order ID', orderId),
                _buildPdfRow('Origin Address', origin),
                _buildPdfRow('Destination Address', destination),
                _buildPdfRow('Total Price Paid', priceStr),
                _buildPdfRow('Driver Wallet Address', driver),
                _buildPdfRow('Transaction Hash', txHash),
                _buildPdfRow('Delivery Completed At', timestamp),
                pw.SizedBox(height: 48),
                pw.Row(
                  mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
                  children: [
                    pw.Column(
                      crossAxisAlignment: pw.CrossAxisAlignment.start,
                      children: [
                        pw.Text('VERIFICATION SEAL', style: pw.TextStyle(fontSize: 12, fontWeight: pw.FontWeight.bold)),
                        pw.SizedBox(height: 4),
                        pw.Text('Scan the QR code on the right to verify the transaction details on Polygonscan.',
                            style: const pw.TextStyle(fontSize: 8, color: PdfColors.grey600)),
                      ],
                    ),
                    _buildPdfQrCode(txHash.isNotEmpty ? 'https://polygonscan.com/tx/$txHash' : 'https://polygonscan.com'),
                  ],
                ),
              ],
            ),
          );
        },
      ),
    );

    await Printing.layoutPdf(
      onLayout: (PdfPageFormat format) async => pdf.save(),
      name: 'Truxify_Receipt_$orderId.pdf',
    );
  }

  static pw.Widget _buildPdfRow(String label, String value) {
    return pw.Padding(
      padding: const pw.EdgeInsets.symmetric(vertical: 8),
      child: pw.Row(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          pw.SizedBox(
            width: 150,
            child: pw.Text(
              label,
              style: pw.TextStyle(fontSize: 11, fontWeight: pw.FontWeight.bold, color: PdfColor.fromInt(0xFF00695C)),
            ),
          ),
          pw.Expanded(
            child: pw.Text(value, style: const pw.TextStyle(fontSize: 11)),
          ),
        ],
      ),
    );
  }

  static pw.Widget _buildPdfQrCode(String data) {
    final qrCode = qr.QrCode.fromData(
      data: data,
      errorCorrectLevel: qr.QrErrorCorrectLevel.M,
    );
    final qrImage = qr.QrImage(qrCode);
    final moduleCount = qrImage.moduleCount;

    return pw.Container(
      width: 90,
      height: 90,
      child: pw.GridView(
        crossAxisCount: moduleCount,
        children: List.generate(moduleCount * moduleCount, (index) {
          final row = index ~/ moduleCount;
          final col = index % moduleCount;
          final isDark = qrImage.isDark(row, col);
          return pw.Container(
            color: isDark ? PdfColors.black : PdfColors.white,
          );
        }),
      ),
    );
  }
}

class QrCodePainter extends CustomPainter {
  final String data;
  QrCodePainter(this.data);

  @override
  void paint(Canvas canvas, Size size) {
    final qrCode = qr.QrCode.fromData(
      data: data,
      errorCorrectLevel: qr.QrErrorCorrectLevel.M,
    );
    final qrImage = qr.QrImage(qrCode);
    final moduleCount = qrImage.moduleCount;
    final moduleSize = size.width / moduleCount;

    final paint = Paint()..color = Colors.black;

    for (var row = 0; row < moduleCount; row++) {
      for (var col = 0; col < moduleCount; col++) {
        if (qrImage.isDark(row, col)) {
          final rect = Rect.fromLTWH(
            col * moduleSize,
            row * moduleSize,
            moduleSize,
            moduleSize,
          );
          canvas.drawRect(rect, paint);
        }
      }
    }
  }

  @override
  bool shouldRepaint(CustomPainter oldDelegate) => false;
}
