import 'dart:async';
import '../models/detention_invoice_model.dart';

class DetentionInvoiceService {
  final _sessionController = StreamController<DetentionInvoiceSession>.broadcast();
  Timer? _timer;
  double _waitHours = 1.8;

  Stream<DetentionInvoiceSession> get invoiceStream => _sessionController.stream;

  void startGeofenceTimer() {
    _emitState(false);
    
    _timer = Timer.periodic(const Duration(seconds: 2), (timer) {
      _waitHours += 0.1;
      
      if (_waitHours >= 2.0 && _waitHours < 2.1) {
        // Trigger threshold
        _emitState(true);
      } else if (_waitHours < 2.5) {
        _emitState(_waitHours >= 2.0);
      } else {
        timer.cancel();
      }
    });
  }

  void _emitState(bool isGenerated) {
    double payout = 0;
    if (_waitHours > 2.0) {
      payout = (_waitHours - 2.0) * 65.0; // $65/hr after 2 hours
    }

    _sessionController.add(DetentionInvoiceSession(
      status: isGenerated ? 'Detention Triggered: Invoice Emailed' : 'Monitoring Geofence Wait Time',
      activeEvent: DetentionEvent(
        facilityName: 'Acme Cold Storage',
        brokerEmail: 'ap@chrobinson.example.com',
        arrivalTime: DateTime.now().subtract(Duration(minutes: (_waitHours * 60).toInt())),
        currentWaitHours: _waitHours,
        hourlyRate: 65.0,
        isInvoiceGenerated: isGenerated,
        estimatedPayout: payout,
      ),
    ));
  }

  void dispose() {
    _timer?.cancel();
    _sessionController.close();
  }
}
