import 'dart:io';
import 'package:flutter/material.dart';
import 'package:signature/signature.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import '../services/pod_storage_service.dart';
import '../services/background_sync_service.dart';

class PodCaptureScreen extends StatefulWidget {
  final String orderId;

  const PodCaptureScreen({super.key, required this.orderId});

  @override
  State<PodCaptureScreen> createState() => _PodCaptureScreenState();
}

class _PodCaptureScreenState extends State<PodCaptureScreen> {
  final SignatureController _signatureController = SignatureController(
    penStrokeWidth: 3,
    penColor: Colors.black,
    exportBackgroundColor: Colors.white,
  );
  
  final ImagePicker _picker = ImagePicker();
  String? _photoPath;
  bool _saving = false;

  Future<void> _takePhoto() async {
    final XFile? photo = await _picker.pickImage(source: ImageSource.camera);
    if (photo != null) {
      setState(() {
        _photoPath = photo.path;
      });
    }
  }

  Future<void> _savePod() async {
    if (_signatureController.isEmpty && _photoPath == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please provide a signature or a photo.')),
      );
      return;
    }

    setState(() {
      _saving = true;
    });

    try {
      String? savedSignaturePath;
      if (_signatureController.isNotEmpty) {
        final signatureImage = await _signatureController.toPngBytes();
        if (signatureImage != null) {
          final directory = await getApplicationDocumentsDirectory();
          final path = '${directory.path}/signature_${widget.orderId}_${DateTime.now().millisecondsSinceEpoch}.png';
          final file = File(path);
          await file.writeAsBytes(signatureImage);
          savedSignaturePath = path;
        }
      }

      String? savedPhotoPath;
      if (_photoPath != null) {
        final directory = await getApplicationDocumentsDirectory();
        final path = '${directory.path}/photo_${widget.orderId}_${DateTime.now().millisecondsSinceEpoch}.jpg';
        final file = File(_photoPath!);
        await file.copy(path);
        savedPhotoPath = path;
      }

      final pod = PodRecord(
        orderId: widget.orderId,
        signaturePath: savedSignaturePath,
        photoPath: savedPhotoPath,
        createdAt: DateTime.now().millisecondsSinceEpoch,
      );

      await podStorageService.insertPod(pod);

      // Check connectivity
      final List<ConnectivityResult> connectivityResult = await Connectivity().checkConnectivity();
      if (connectivityResult.contains(ConnectivityResult.none)) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Saved offline. Will sync when online.')),
          );
        }
      } else {
        // Trigger sync immediately if online
        BackgroundSyncService.syncPods();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('PoD saved and syncing in background.')),
          );
        }
      }

      if (mounted) {
        Navigator.pop(context);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to save PoD: $e')),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _saving = false;
        });
      }
    }
  }

  @override
  void dispose() {
    _signatureController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Capture Proof of Delivery'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Driver / Receiver Signature',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Container(
              decoration: BoxDecoration(
                border: Border.all(color: Colors.grey),
              ),
              child: Signature(
                controller: _signatureController,
                height: 200,
                backgroundColor: Colors.white,
              ),
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => _signatureController.clear(),
                  child: const Text('Clear Signature'),
                ),
              ],
            ),
            const SizedBox(height: 16),
            const Text(
              'Delivery Photo (Optional)',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            if (_photoPath != null)
              Image.file(File(_photoPath!), height: 200, fit: BoxFit.cover),
            ElevatedButton.icon(
              onPressed: _takePhoto,
              icon: const Icon(Icons.camera_alt),
              label: Text(_photoPath == null ? 'Take Photo' : 'Retake Photo'),
            ),
            const SizedBox(height: 32),
            ElevatedButton(
              onPressed: _saving ? null : _savePod,
              style: ElevatedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 16),
                backgroundColor: Theme.of(context).primaryColor,
                foregroundColor: Colors.white,
              ),
              child: _saving 
                ? const CircularProgressIndicator(color: Colors.white)
                : const Text('Save Proof of Delivery', style: TextStyle(fontSize: 16)),
            ),
          ],
        ),
      ),
    );
  }
}
