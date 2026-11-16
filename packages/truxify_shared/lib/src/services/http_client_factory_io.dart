import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';

http.Client createHttpClient() {
  // The default constructor honors HttpOverrides (the standard test/dev
  // interception point); an explicitly constructed HttpClient(context: ...)
  // bypasses it entirely, making every consumer untestable.
  final ioClient = HttpClient()
    ..badCertificateCallback = (X509Certificate cert, String host, int port) {
      return false;
    };
  return IOClient(ioClient);
}
