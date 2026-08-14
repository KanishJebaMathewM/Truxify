import 'dart:async';
import '../models/yard_management_model.dart';

class YardManagementService {
  final _sessionController = StreamController<YardManagementSession>.broadcast();
  
  Stream<YardManagementSession> get yardStream => _sessionController.stream;

  List<YardTrailer> _trailers = [];
  List<YardInstruction> _instructions = [];

  void initializeYard() {
    _trailers = [
      YardTrailer(trailerId: 'TR-1045', status: 'Loaded', location: 'Spot A1'),
      YardTrailer(trailerId: 'TR-2201', status: 'Empty', location: 'Spot B4'),
      YardTrailer(trailerId: 'TR-0992', status: 'Maintenance', location: 'Spot C2'),
      YardTrailer(trailerId: 'TR-3410', status: 'Loaded', location: 'Dock 1'),
    ];

    _emitState('Listening to Dispatch WebSockets', false);
  }

  void simulateIncomingDispatchInstruction() async {
    _emitState('Syncing Dispatch Instructions...', true);

    await Future.delayed(const Duration(seconds: 1));

    _instructions.add(
      YardInstruction(
        instructionId: 'CMD-9941',
        trailerId: 'TR-1045',
        targetLocation: 'Dock 3',
        issuedAt: DateTime.now(),
      )
    );

    _emitState('New Instruction Received', false);
  }

  void completeInstruction(String instructionId) async {
    _emitState('Confirming Move via WebSockets...', true);

    await Future.delayed(const Duration(seconds: 1));

    // Find the instruction
    int cmdIndex = _instructions.indexWhere((i) => i.instructionId == instructionId);
    if (cmdIndex != -1) {
      _instructions[cmdIndex].isCompleted = true;
      
      // Update trailer location
      String targetTrailer = _instructions[cmdIndex].trailerId;
      int trIndex = _trailers.indexWhere((t) => t.trailerId == targetTrailer);
      if (trIndex != -1) {
        _trailers[trIndex].location = _instructions[cmdIndex].targetLocation;
      }
    }

    _emitState('Yard Grid Synchronized', false);
  }

  void _emitState(String status, bool isSyncing) {
    _sessionController.add(YardManagementSession(
      status: status,
      trailers: List.from(_trailers),
      activeInstructions: _instructions.where((i) => !i.isCompleted).toList(),
      isSyncing: isSyncing,
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
