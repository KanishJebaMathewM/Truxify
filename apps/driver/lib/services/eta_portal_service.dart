import 'dart:async';
import 'dart:math';
import '../models/eta_portal_model.dart';

class EtaPortalService {
  final _sessionController = StreamController<PortalState>.broadcast();
  
  Stream<PortalState> get portalStream => _sessionController.stream;

  void initializePortal() {
    _emitState('Ready to generate secure tracking link', false, null, null, null, null, 120);
  }

  void generateTrackingLink() async {
    _emitState('Establishing Secure Ephemeral Socket...', true, null, null, null, null, 120);

    await Future.delayed(const Duration(seconds: 1));
    
    _emitState('Querying Live Traffic API...', true, null, null, null, null, 120);

    await Future.delayed(const Duration(seconds: 1));
    
    String randId = (Random().nextInt(900000) + 100000).toString();
    String randPass = 'TRX-${Random().nextInt(9000) + 1000}';
    
    DateTime now = DateTime.now();
    DateTime eta = now.add(const Duration(hours: 2, minutes: 15)); // Assuming heavy traffic
    
    _emitState(
      'Tracking Portal Live', 
      false, 
      'https://truxify.app/track/$randId', 
      randPass, 
      eta, 
      'Heavy delays on I-95 South (Construction)', 
      120
    );
  }

  void _emitState(String status, bool isGenerating, String? url, String? pass, DateTime? eta, String? traffic, int miles) {
    _sessionController.add(PortalState(
      status: status,
      isGeneratingLink: isGenerating,
      secureTrackingUrl: url,
      generatedPassword: pass,
      estimatedTimeOfArrival: eta,
      trafficConditions: traffic,
      milesRemaining: miles,
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
