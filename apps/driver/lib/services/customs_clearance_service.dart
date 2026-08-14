import 'dart:async';
import '../models/customs_clearance_model.dart';

class CustomsClearanceService {
  final _sessionController = StreamController<CustomsClearanceSession>.broadcast();

  Stream<CustomsClearanceSession> get clearanceStream => _sessionController.stream;

  void simulateClearance() async {
    final crossing = 'Laredo World Trade Bridge (US/MX)';

    // 1. Sending data
    _sessionController.add(CustomsClearanceSession(
      borderCrossing: crossing,
      status: 'Transmitting ACE/ACI Data to CBP...',
      documents: [
        CustomsDocument(documentType: 'e-Manifest', documentId: 'MN-992-81A', status: 'Pending API'),
        CustomsDocument(documentType: 'Commercial Invoice', documentId: 'INV-441-2', status: 'Pending API'),
        CustomsDocument(documentType: 'Driver Passport (FAST)', documentId: 'PASS-US-891', status: 'Pending API'),
      ],
      isCleared: false,
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Verifying
    _sessionController.add(CustomsClearanceSession(
      borderCrossing: crossing,
      status: 'Awaiting CBP Agent Authorization...',
      documents: [
        CustomsDocument(documentType: 'e-Manifest', documentId: 'MN-992-81A', status: 'Verified'),
        CustomsDocument(documentType: 'Commercial Invoice', documentId: 'INV-441-2', status: 'Verified'),
        CustomsDocument(documentType: 'Driver Passport (FAST)', documentId: 'PASS-US-891', status: 'Verified'),
      ],
      isCleared: false,
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Cleared
    _sessionController.add(CustomsClearanceSession(
      borderCrossing: crossing,
      status: 'PRE-CLEARED FOR FAST LANE',
      documents: [
        CustomsDocument(documentType: 'e-Manifest', documentId: 'MN-992-81A', status: 'Verified'),
        CustomsDocument(documentType: 'Commercial Invoice', documentId: 'INV-441-2', status: 'Verified'),
        CustomsDocument(documentType: 'Driver Passport (FAST)', documentId: 'PASS-US-891', status: 'Verified'),
      ],
      isCleared: true,
      fastLaneBarcode: 'CBP-FAST-89912044', // Rendered as barcode in UI
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
