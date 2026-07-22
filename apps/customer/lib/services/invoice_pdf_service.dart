import 'package:pdf/pdf.dart';
import 'package:printing/printing.dart';

import '../models/app_models.dart';
import '../widgets/invoice/invoice_template.dart';

/// Service responsible for generating and presenting order invoices as PDF.
///
/// No UI code lives here — only PDF generation and print/share orchestration.
class InvoicePdfService {
  /// Generates PDF bytes for the given [order].
  ///
  /// Returns raw PDF bytes suitable for printing or saving.
  static Future<List<int>> generatePdfBytes(HistoryOrderData order) async {
    final data = _mapOrderToInvoiceData(order);
    final doc = buildInvoicePdf(data);
    return doc.save();
  }

  /// Opens the native print/share preview for the given [order].
  ///
  /// Allows the user to print, save, or share the invoice.
  static Future<void> printOrShareInvoice(HistoryOrderData order) async {
    final data = _mapOrderToInvoiceData(order);
    final doc = buildInvoicePdf(data);
    final bytes = await doc.save();

    await Printing.layoutPdf(
      onLayout: (_) => bytes,
      name: 'Truxify_Invoice_${order.orderId}',
    );
  }

  /// Maps [HistoryOrderData] to [InvoiceData] for the template.
  static InvoiceData _mapOrderToInvoiceData(HistoryOrderData order) {
    final routeParts = order.route.split(' → ');
    final pickup = routeParts.length == 2 ? routeParts.first : order.route;
    final drop = routeParts.length == 2 ? routeParts.last : order.route;

    return InvoiceData(
      orderId: order.orderId,
      date: order.date,
      status: order.status,
      pickupAddress: pickup,
      dropAddress: drop,
      driverName: order.driver,
      truckNumber: order.truckNumber,
      driverPhone: order.driverPhone,
      baseFare: order.baseFare,
      distanceCharge: order.distanceCharge,
      tollCharge: order.tollCharge,
      platformFee: order.platformFee,
      total: order.amount,
      blockchainTxHash: order.blockchainTxHash,
    );
  }
}
