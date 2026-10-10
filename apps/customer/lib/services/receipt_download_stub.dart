import 'dart:typed_data';

/// Non-web fallback for the conditional import in
/// receipt_generator_service.dart. Mobile builds share/print via the
/// printing package instead; this path is never taken on mobile.
void triggerFileDownload(Uint8List bytes, String filename) {
  throw UnsupportedError('Blob download is only available on web.');
}
