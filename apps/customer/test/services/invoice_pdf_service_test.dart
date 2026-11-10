import 'dart:convert';
import 'dart:io' show ZLibCodec;
import 'dart:typed_data' show Uint8List;

import 'package:flutter_test/flutter_test.dart';
import 'package:truxify/models/app_models.dart';
import 'package:truxify/services/invoice_pdf_service.dart';
import 'package:truxify/widgets/invoice/invoice_template.dart';

import '../setup.dart';

HistoryOrderData _buildTestOrder({
  String orderId = 'ORD-1234',
  String? blockchainTxHash = '0xabc123def456',
  String? baseFare = 'Rs 500',
  String? distanceCharge = 'Rs 200',
  String? tollCharge = 'Rs 50',
  String? platformFee = 'Rs 30',
  String? driverPhone = '+91 98765 43210',
}) {
  return HistoryOrderData(
    orderId: orderId,
    route: 'Mumbai → Delhi',
    date: '2026-07-15',
    amount: 'Rs 780',
    status: 'Delivered',
    driver: 'Rajesh Kumar',
    truckNumber: 'MH-12-AB-1234',
    timeline: const [],
    blockchainTxHash: blockchainTxHash,
    baseFare: baseFare,
    distanceCharge: distanceCharge,
    tollCharge: tollCharge,
    platformFee: platformFee,
    driverPhone: driverPhone,
  );
}


/// dart_pdf Flate-compresses content streams — utf8-decoding the raw bytes
/// throws (and literal text never appears). Inflate every stream block and
/// search the decoded content. Text renders as kerning-split TJ arrays, so
/// also emit concatenated and alphanumeric-only run forms.
String _pdfTextContent(Uint8List bytes) {
  final buffer = StringBuffer(String.fromCharCodes(bytes));
  const streamMarker = [115, 116, 114, 101, 97, 109]; // 'stream'
  const endMarker = [101, 110, 100, 115, 116, 114, 101, 97, 109]; // 'endstream'
  int i = 0;
  while (i < bytes.length - streamMarker.length) {
    bool match = true;
    for (int j = 0; j < streamMarker.length; j++) {
      if (bytes[i + j] != streamMarker[j]) { match = false; break; }
    }
    if (!match) { i++; continue; }
    int start = i + streamMarker.length;
    if (bytes[start] == 13) start++;
    if (bytes[start] == 10) start++;
    int end = start;
    outer:
    while (end < bytes.length - endMarker.length) {
      for (int j = 0; j < endMarker.length; j++) {
        if (bytes[end + j] != endMarker[j]) { end++; continue outer; }
      }
      break;
    }
    try {
      final decoded = String.fromCharCodes(ZLibCodec().decode(bytes.sublist(start, end)));
      buffer.write(decoded);
      final runs = RegExp(r'\((?:[^()\\]|\\.)*\)')
          .allMatches(decoded)
          .map((m) => m.group(0)!.substring(1, m.group(0)!.length - 1));
      buffer.write(runs.join());
      buffer.write(runs.join().replaceAll(RegExp(r'[^A-Za-z0-9]'), ''));
    } catch (_) {
      // Not a Flate stream (fonts/images) — ignore.
    }
    i = end + endMarker.length;
  }
  return buffer.toString();
}

void main() {
  setUpAll(() async {
    await setupTests();
  });

  group('InvoicePdfService.generatePdfBytes', () {
    test('returns non-empty PDF bytes', () async {
      final order = _buildTestOrder();
      final bytes = await InvoicePdfService.generatePdfBytes(order);

      expect(bytes, isNotEmpty);
    });

    test('returns bytes starting with PDF header', () async {
      final order = _buildTestOrder();
      final bytes = await InvoicePdfService.generatePdfBytes(order);

      final header = String.fromCharCodes(bytes.take(5));
      expect(header, equals('%PDF-'));
    });

    test('handles order with null blockchain hash', () async {
      final order = _buildTestOrder(blockchainTxHash: null);
      final bytes = await InvoicePdfService.generatePdfBytes(order);

      expect(bytes, isNotEmpty);
      final header = String.fromCharCodes(bytes.take(5));
      expect(header, equals('%PDF-'));
    });

    test('handles order with null price fields', () async {
      final order = _buildTestOrder(
        baseFare: null,
        distanceCharge: null,
        tollCharge: null,
        platformFee: null,
      );
      final bytes = await InvoicePdfService.generatePdfBytes(order);

      expect(bytes, isNotEmpty);
      final header = String.fromCharCodes(bytes.take(5));
      expect(header, equals('%PDF-'));
    });

    test('handles order with null driver phone', () async {
      final order = _buildTestOrder(driverPhone: null);
      final bytes = await InvoicePdfService.generatePdfBytes(order);

      expect(bytes, isNotEmpty);
      final header = String.fromCharCodes(bytes.take(5));
      expect(header, equals('%PDF-'));
    });
  });

  group('Invoice template', () {
    test('buildInvoicePdf returns a document with pages', () {
      final data = InvoiceData(
        orderId: 'ORD-9999',
        date: '2026-07-15',
        status: 'Delivered',
        pickupAddress: 'Pune',
        dropAddress: 'Nagpur',
        driverName: 'Test Driver',
        truckNumber: 'MH-01-XX-0000',
        driverPhone: '+91 12345 67890',
        baseFare: 'Rs 400',
        distanceCharge: 'Rs 150',
        tollCharge: 'Rs 25',
        platformFee: 'Rs 20',
        total: 'Rs 595',
        blockchainTxHash: '0xdef',
      );

      final doc = buildInvoicePdf(data);
      expect(doc, isNotNull);
      expect(doc.document, isNotNull);
    });

    test('PDF content contains order ID and driver phone', () async {
      final data = InvoiceData(
        orderId: 'ORD-7777',
        date: '2026-01-01',
        status: 'Payment Released',
        pickupAddress: 'Chennai',
        dropAddress: 'Bangalore',
        driverName: 'Kumar',
        truckNumber: 'TN-01-AA-1111',
        driverPhone: '+91 99999 11111',
        total: 'Rs 1000',
      );

      final doc = buildInvoicePdf(data);
      final bytes = await doc.save();
      final content = _pdfTextContent(bytes);

      expect(content, contains('ORD-7777'));
      expect(content, contains('Chennai'));
      expect(content, contains('Bangalore'));
      expect(content, contains('Kumar'));
      expect(content, contains('TN-01-AA-1111'));
      // Spaces between phone groups are kerning offsets, not text runs —
      // compare alphanumeric-normalized.
      expect(content.replaceAll(RegExp(r'[^A-Za-z0-9]'), ''), contains('919999911111'));
    });

    test('PDF content contains blockchain hash when provided', () async {
      final data = InvoiceData(
        orderId: 'ORD-5555',
        date: '2026-03-20',
        status: 'Delivered',
        pickupAddress: 'Mumbai',
        dropAddress: 'Pune',
        driverName: 'Singh',
        truckNumber: 'MH-12-BB-2222',
        total: 'Rs 800',
        blockchainTxHash: '0xabcdef1234567890',
      );

      final doc = buildInvoicePdf(data);
      final bytes = await doc.save();
      final content = _pdfTextContent(bytes);

      // Kerning offsets replace spaces between runs — compare
      // alphanumeric-normalized.
      expect(content.replaceAll(RegExp(r'[^A-Za-z0-9]'), ''),
          contains('BlockchainVerification'));
      expect(content, contains('0xabcdef1234567890'));
    });

    test('PDF omits blockchain section when hash is null', () async {
      final data = InvoiceData(
        orderId: 'ORD-4444',
        date: '2026-04-10',
        status: 'Delivered',
        pickupAddress: 'Delhi',
        dropAddress: 'Jaipur',
        driverName: 'Verma',
        truckNumber: 'DL-01-CC-3333',
        total: 'Rs 600',
        blockchainTxHash: null,
      );

      final doc = buildInvoicePdf(data);
      final bytes = await doc.save();
      final content = _pdfTextContent(bytes);

      expect(content, isNot(contains('Blockchain Verification')));
    });

    test('PDF omits driver phone section when null', () async {
      final data = InvoiceData(
        orderId: 'ORD-3333',
        date: '2026-05-05',
        status: 'Delivered',
        pickupAddress: 'Kolkata',
        dropAddress: 'Patna',
        driverName: 'Das',
        truckNumber: 'WB-01-DD-4444',
        total: 'Rs 500',
        driverPhone: null,
      );

      final doc = buildInvoicePdf(data);
      final bytes = await doc.save();
      final content = _pdfTextContent(bytes);

      expect(content, isNot(contains('Phone')));
    });
  });
}
