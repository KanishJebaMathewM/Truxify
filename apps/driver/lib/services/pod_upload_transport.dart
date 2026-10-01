import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import 'pod_storage_service.dart';

class PodUploadTransport {
  final Uri baseUri;
  final http.Client Function() clientFactory;
  final Duration timeout;
  PodUploadTransport(
    this.baseUri, {
    http.Client Function()? clientFactory,
    this.timeout = const Duration(seconds: 30),
  }) : clientFactory = clientFactory ?? http.Client.new;

  Future<int> upload(PodRecord pod, String token) async {
    final client = clientFactory();
    try {
      return await _send(client, pod, token).timeout(timeout);
    } finally {
      // Close aborts native IO on timeout; timeout alone would leave it running.
      client.close();
    }
  }

  Future<int> _send(http.Client client, PodRecord pod, String token) async {
    final uri = baseUri.replace(
      path: '${baseUri.path}/api/orders/${Uri.encodeComponent(pod.orderId)}/pod'
          .replaceAll(RegExp(r'/+'), '/'),
      query: null,
      fragment: null,
    );
    final request = http.MultipartRequest('POST', uri);
    request.headers['Authorization'] = 'Bearer $token';
    request.headers['X-Idempotency-Key'] = pod.uploadKey!;
    for (final entry in {
      'signature': pod.signaturePath,
      'photo': pod.photoPath,
    }.entries) {
      if (entry.value == null) continue;
      if (!await File(entry.value!).exists())
        throw FileSystemException('POD attachment unavailable');
      request.files.add(
        await http.MultipartFile.fromPath(
          entry.key,
          entry.value!,
          contentType: MediaType(
            'image',
            entry.key == 'signature' ? 'png' : 'jpeg',
          ),
        ),
      );
    }
    if (request.files.isEmpty) throw StateError('POD has no attachments');
    final response = await client.send(request);
    await response.stream.drain<void>();
    return response.statusCode;
  }
}
