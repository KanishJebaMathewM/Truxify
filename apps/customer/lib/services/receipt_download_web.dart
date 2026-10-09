import 'dart:html' as html;
import 'dart:typed_data';

/// Web implementation: downloads the bytes as a Blob via an anchor click.
void triggerFileDownload(Uint8List bytes, String filename) {
  final blob = html.Blob([bytes], 'application/pdf');
  final url = html.Url.createObjectUrlFromBlob(blob);
  html.AnchorElement(href: url)
    ..setAttribute('download', filename)
    ..click();
  html.Url.revokeObjectUrl(url);
}
