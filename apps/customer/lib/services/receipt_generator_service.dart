import 'dart:typed_data';
import 'package:pdf/pdf.dart' as pw_pdf;
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

// Conditional import for web blob downloading
import 'receipt_download_stub.dart'
    if (dart.library.html) 'receipt_download_web.dart';

class ReceiptGeneratorService {
  /// Generates a professional delivery receipt / waybill PDF in-memory.
  static Future<Uint8List> generateReceiptPdf(Map<String, dynamic> orderData) async {
    final pdf = pw.Document();

    pdf.addPage(
      pw.Page(
        pageFormat: pw_pdf.PdfPageFormat.a4,
        margin: const pw.EdgeInsets.all(32),
        build: (pw.Context context) {
          return pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              // Header & Logo / Title
              pw.Row(
                mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
                children: [
                  pw.Column(
                    crossAxisAlignment: pw.CrossAxisAlignment.start,
                    children: [
                      pw.Text(
                        'TRUXIFY FREIGHT LOGISTICS',
                        style: pw.TextStyle(
                          fontSize: 20,
                          fontWeight: pw.FontWeight.bold,
                          color: pw_pdf.PdfColors.blue800,
                        ),
                      ),
                      const pw.SizedBox(height: 4),
                      pw.Text(
                        'Official Delivery Receipt & Waybill',
                        style: const pw.TextStyle(
                          fontSize: 12,
                          color: pw_pdf.PdfColors.grey700,
                        ),
                      ),
                    ],
                  ),
                  // Barcode / Order Identifier Badge
                  pw.Container(
                    padding: const pw.EdgeInsets.all(8),
                    decoration: pw.BoxDecoration(
                      border: pw.Border.all(color: pw_pdf.PdfColors.grey400),
                      borderRadius: const pw.BorderRadius.all(pw.Radius.circular(6)),
                    ),
                    child: pw.Column(
                      crossAxisAlignment: pw.CrossAxisAlignment.end,
                      children: [
                        pw.Text(
                          'Order ID: ${orderData['orderId'] ?? 'TRX-998821'}',
                          style: pw.TextStyle(
                              fontWeight: pw.FontWeight.bold, fontSize: 10),
                        ),
                        pw.Text(
                          'Date: ${orderData['date'] ?? 'October 7, 2026'}',
                          style: const pw.TextStyle(
                              fontSize: 9, color: pw_pdf.PdfColors.grey600),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const pw.SizedBox(height: 20),
              pw.Divider(color: pw_pdf.PdfColors.grey400),
              const pw.SizedBox(height: 20),

              // Route & Shipment Parties
              pw.Row(
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: pw.Column(
                      crossAxisAlignment: pw.CrossAxisAlignment.start,
                      children: [
                        pw.Text('PICKUP LOCATION',
                            style: pw.TextStyle(
                                fontWeight: pw.FontWeight.bold,
                                fontSize: 11,
                                color: pw_pdf.PdfColors.blueGrey800)),
                        const pw.SizedBox(height: 4),
                        pw.Text(
                            orderData['pickupAddress'] ??
                                'SIPCOT Industrial Park, Plot 42, Chennai, TN',
                            style: const pw.TextStyle(fontSize: 10)),
                      ],
                    ),
                  ),
                  const pw.SizedBox(width: 16),
                  Expanded(
                    child: pw.Column(
                      crossAxisAlignment: pw.CrossAxisAlignment.start,
                      children: [
                        pw.Text('DELIVERY DESTINATION',
                            style: pw.TextStyle(
                                fontWeight: pw.FontWeight.bold,
                                fontSize: 11,
                                color: pw_pdf.PdfColors.blueGrey800)),
                        const pw.SizedBox(height: 4),
                        pw.Text(
                            orderData['deliveryAddress'] ??
                                'Logistics Hub Sector 5, Bangalore, KA',
                            style: const pw.TextStyle(fontSize: 10)),
                      ],
                    ),
                  ),
                ],
              ),
              const pw.SizedBox(height: 24),

              // Freight Specifications Table
              pw.Text('FREIGHT MANIFEST & CHARGES',
                  style: pw.TextStyle(
                      fontWeight: pw.FontWeight.bold,
                      fontSize: 12,
                      color: pw_pdf.PdfColors.blue800)),
              const pw.SizedBox(height: 8),
              pw.Table.fromTextArray(
                headerStyle: pw.TextStyle(
                    fontWeight: pw.FontWeight.bold,
                    color: pw_pdf.PdfColors.white,
                    fontSize: 10),
                headerDecoration:
                    const pw.BoxDecoration(color: pw_pdf.PdfColors.blue800),
                cellStyle: const pw.TextStyle(fontSize: 10),
                cellPadding: const pw.EdgeInsets.all(8),
                headers: ['Item Description', 'Vehicle Type', 'Weight / Qty', 'Amount (INR)'],
                data: [
                  [
                    orderData['cargoDescription'] ?? 'Industrial Electronics & Hardware',
                    orderData['vehicleType'] ?? 'Heavy Truck (Multi-Axle)',
                    orderData['weight'] ?? '4.2 Tons',
                    orderData['amount'] ?? 'INR 14,500.00',
                  ],
                ],
              ),
              const pw.SizedBox(height: 30),

              // Verification QR Code & Signoff
              pw.Row(
                mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
                crossAxisAlignment: pw.CrossAxisAlignment.end,
                children: [
                  // QR Code verification
                  pw.BarcodeWidget(
                    barcode: pw.Barcode.qrCode(),
                    data: 'https://truxify.app/verify/${orderData['orderId'] ?? 'TRX-998821'}',
                    width: 70,
                    height: 70,
                  ),
                  pw.Column(
                    crossAxisAlignment: pw.CrossAxisAlignment.end,
                    children: [
                      pw.Container(
                        width: 150,
                        height: 1,
                        color: pw_pdf.PdfColors.grey600,
                      ),
                      const pw.SizedBox(height: 6),
                      const pw.Text('Authorized Signatory',
                          style: pw.TextStyle(
                              fontSize: 10, color: pw_pdf.PdfColors.grey700)),
                    ],
                  ),
                ],
              ),
            ],
          );
        },
      ),
    );

    return pdf.save();
  }

  /// Triggers direct browser download for web or native print dialog.
  static Future<void> downloadOrPrintReceipt(
      Map<String, dynamic> orderData, {bool isPrint = false}) async {
    final pdfBytes = await generateReceiptPdf(orderData);

    if (isPrint) {
      await Printing.layoutPdf(
        onLayout: (pw_pdf.PdfPageFormat format) async => pdfBytes,
        name: 'Truxify-Waybill-${orderData['orderId'] ?? 'Receipt'}.pdf',
      );
    } else {
      // Trigger Web Blob download or mobile file save
      triggerFileDownload(
        pdfBytes,
        'Truxify-Waybill-${orderData['orderId'] ?? 'Receipt'}.pdf',
      );
    }
  }
}
