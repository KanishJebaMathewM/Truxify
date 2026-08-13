import 'dart:async';
import '../models/night_vision_model.dart';

class NightVisionService {
  final _sessionController = StreamController<NightVisionSettings>.broadcast();
  bool _isEnabled = true; // Default to on for demo

  Stream<NightVisionSettings> get settingsStream => _sessionController.stream;

  void initialize() {
    _emitState();
  }

  void toggleNightVision(bool value) {
    _isEnabled = value;
    _emitState();
  }

  void _emitState() {
    _sessionController.add(NightVisionSettings(
      isNightVisionEnabled: _isEnabled,
      redTintIntensity: 0.85,
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
