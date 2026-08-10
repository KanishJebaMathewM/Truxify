import 'dart:io';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:path_provider/path_provider.dart';

class ImageCompressionService {
  static Future<File?> compressImage(File file) async {
    try {
      final dir = await getTemporaryDirectory();
      final targetPath = '${dir.absolute.path}/temp_${DateTime.now().millisecondsSinceEpoch}.jpg';
      
      final XFile? compressedFile = await FlutterImageCompress.compressAndGetFile(
        file.absolute.path,
        targetPath,
        quality: 80,
        minWidth: 1920,
        minHeight: 1920,
      );
      
      if (compressedFile != null) {
        return File(compressedFile.path);
      }
    } catch (e) {
      print('Compression error: $e');
    }
    return file; // Fallback to original if compression fails
  }

  static String getFileSize(File file) {
    final bytes = file.lengthSync();
    if (bytes <= 0) return "0 B";
    final kb = bytes / 1024;
    if (kb > 1024) {
      return '${(kb / 1024).toStringAsFixed(2)} MB';
    }
    return '${kb.toStringAsFixed(0)} KB';
  }
}
