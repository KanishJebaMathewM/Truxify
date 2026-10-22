// apps/driver/lib/services/api_client_io.dart
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';

http.Client createHttpClient() {
  final ioClient = HttpClient()
    ..badCertificateCallback = (X509Certificate cert, String host, int port) => false; // Example SSL pinning / security
  return IOClient(ioClient);
}
