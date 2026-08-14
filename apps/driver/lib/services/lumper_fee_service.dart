import 'dart:async';
import '../models/lumper_fee_model.dart';

class LumperFeeService {
  final _sessionController = StreamController<LumperFeeSession>.broadcast();
  
  Stream<LumperFeeSession> get lumperStream => _sessionController.stream;

  void initializeScanner() {
    _emitState('Awaiting Receipt Upload', null, null, false);
  }

  void processReceiptUpload() async {
    _emitState('Running OCR on Receipt Image...', null, null, true);

    await Future.delayed(const Duration(seconds: 1));

    LumperReceipt receipt = LumperReceipt(
      loadId: 'LD-922',
      warehouseName: 'Kroger Distribution Center',
      amountPaid: 325.50,
      dateScanned: DateTime.now().toIso8601String(),
      ocrConfidence: '98.5%',
    );
    
    _emitState('OCR Complete. Generating PDF Invoice...', receipt, null, true);

    await Future.delayed(const Duration(seconds: 1));

    _emitState('Firing Accounts Receivable Webhook to Broker...', receipt, null, true);

    await Future.delayed(const Duration(seconds: 1));

    ReimbursementTicket ticket = ReimbursementTicket(
      ticketId: 'AR-TKT-55421',
      brokerApiEndpoint: 'api.chrobinson.com/v2/invoicing',
      status: 'Awaiting Broker Approval',
      timestamp: DateTime.now().toIso8601String(),
    );

    _emitState('Reimbursement Ticket Submitted', receipt, ticket, false);
  }

  void _emitState(String status, LumperReceipt? receipt, ReimbursementTicket? ticket, bool isProcessing) {
    _sessionController.add(LumperFeeSession(
      status: status,
      scannedReceipt: receipt,
      activeTicket: ticket,
      isProcessing: isProcessing,
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
