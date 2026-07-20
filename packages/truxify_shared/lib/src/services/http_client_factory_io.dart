import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';

http.Client createHttpClient() {
  final securityContext = SecurityContext(withTrustedRoots: true);
  final ioClient = HttpClient(context: securityContext)
    ..badCertificateCallback = (X509Certificate cert, String host, int port) {
      return false;
    };
  return IOClient(ioClient);
}
