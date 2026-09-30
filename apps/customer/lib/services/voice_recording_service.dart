import 'dart:typed_data';

import 'package:record/record.dart';

/// Platform-agnostic voice recording service.
///
/// Mobile:
/// Uses the native recorder provided by the `record` package.
///
/// Web:
/// Uses the browser MediaRecorder API internally.
///
/// This keeps voice_ai_screen.dart independent of the platform.
class VoiceRecordingService {
  final AudioRecorder _recorder = AudioRecorder();

  bool _isRecording = false;

  /// Returns true if the microphone can be accessed.
  Future<bool> hasPermission() async {
    try {
      return await _recorder.hasPermission();
    } catch (e) {
      return false;
    }
  }

  /// Start recording audio.
  ///
  /// Web browsers will automatically request microphone permission.
  /// On Android/iOS, the native microphone permission is requested.
  Future<bool> startRecording() async {
    try {
      if (_isRecording) {
        return true;
      }

      final hasPermission = await _recorder.hasPermission();

      if (!hasPermission) {
        return false;
      }

      const config = RecordConfig(
        encoder: AudioEncoder.opus,
        sampleRate: 16000,
        numChannels: 1,
        bitRate: 64000,
      );

      await _recorder.start(config);

      _isRecording = true;

      return true;
    } catch (e) {
      return false;
    }
  }

  /// Stop recording and return the recorded audio.
  ///
  /// The returned bytes can be sent to the backend Voice AI service.
  Future<Uint8List?> stopRecording() async {
    try {
      if (!_isRecording) {
        return null;
      }

      final path = await _recorder.stop();

      _isRecording = false;

      if (path == null || path.isEmpty) {
        return null;
      }

      // The record package handles the platform-specific
      // audio storage/recording implementation.
      final audioBytes = await _recorder.read(path);

      return audioBytes;
    } catch (e) {
      _isRecording = false;
      return null;
    }
  }

  /// Cancel the current recording without returning audio.
  Future<void> cancelRecording() async {
    try {
      if (_isRecording) {
        await _recorder.cancel();
      }
    } catch (_) {
      // Ignore cancellation errors.
    } finally {
      _isRecording = false;
    }
  }

  /// Returns whether recording is currently active.
  bool get isRecording => _isRecording;

  /// Dispose the recorder.
  void dispose() {
    _recorder.dispose();
  }
}
