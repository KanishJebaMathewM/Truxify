import 'dart:io';
import 'package:flutter/material.dart';
import 'package:camera/camera.dart';
import 'package:signature/signature.dart';
import 'package:path_provider/path_provider.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:truxify_shared/truxify_shared.dart';
import '../services/sync_service.dart';

class ProofOfDeliveryScreen extends StatefulWidget {
  final String tripDisplayId;
  final String stopId;
  final String? orderId;
  final Future<void> Function(String? photoPath, String? signaturePath)? onComplete;

  const ProofOfDeliveryScreen({
    Key? key,
    required this.tripDisplayId,
    required this.stopId,
    this.orderId,
    this.onComplete,
  }) : super(key: key);

  @override
  State<ProofOfDeliveryScreen> createState() => _ProofOfDeliveryScreenState();
}

class _ProofOfDeliveryScreenState extends State<ProofOfDeliveryScreen> {
  CameraController? _cameraController;
  late SignatureController _signatureController;
  XFile? _capturedPhoto;
  bool _isProcessing = false;
  String _uploadStatus = '';
  double? _uploadProgress;

  @override
  void initState() {
    super.initState();
    _signatureController = SignatureController(
      penStrokeWidth: 3,
      penColor: Colors.black,
      exportBackgroundColor: Colors.white,
    );
    _initCamera();
  }

  Future<void> _initCamera() async {
    try {
      final cameras = await availableCameras();
      if (cameras.isNotEmpty) {
        _cameraController = CameraController(cameras.first, ResolutionPreset.medium);
        await _cameraController!.initialize();
        if (mounted) setState(() {});
      }
    } catch (e) {
      debugPrint('Error initializing camera: $e');
    }
  }

  @override
  void dispose() {
    _cameraController?.dispose();
    _signatureController.dispose();
    super.dispose();
  }

  Future<void> _takePhoto() async {
    if (_cameraController == null || !_cameraController!.value.isInitialized) return;
    try {
      final photo = await _cameraController!.takePicture();
      setState(() {
        _capturedPhoto = photo;
      });
    } catch (e) {
      debugPrint('Error taking photo: $e');
    }
  }

  void _updateStatus(String status, {double? progress}) {
    if (mounted) {
      setState(() {
        _uploadStatus = status;
        _uploadProgress = progress;
      });
    }
  }

  Future<void> _submit() async {
    if (_capturedPhoto == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Please capture a photo.')));
      return;
    }
    if (_signatureController.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Please provide a signature.')));
      return;
    }

    setState(() => _isProcessing = true);

    try {
      final signBytes = await _signatureController.toPngBytes();
      String? signPath;
      if (signBytes != null) {
        final dir = await getApplicationDocumentsDirectory();
        final file = File('${dir.path}/sign_${widget.stopId}_${DateTime.now().millisecondsSinceEpoch}.png');
        await file.writeAsBytes(signBytes);
        signPath = file.path;
      }

      _updateStatus('Uploading proof of delivery...');

      if (widget.onComplete != null) {
        await widget.onComplete!(_capturedPhoto?.path, signPath);
      } else {
        await SyncService.instance.queueOrSyncPoD(
          tripDisplayId: widget.tripDisplayId,
          stopId: widget.stopId,
          orderId: widget.orderId,
          photoPath: _capturedPhoto?.path,
          signaturePath: signPath,
          onProgress: _updateStatus,
        );
      }

      _updateStatus('Upload complete!');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Proof of Delivery submitted successfully'),
            backgroundColor: Colors.green,
          ),
        );
        Navigator.of(context).pop();
      }
    } catch (e) {
      if (mounted) {
        _updateStatus('Upload failed, will retry when online.');
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Upload failed. Will retry when online: $e'),
            backgroundColor: Colors.orange,
          ),
        );
        Navigator.of(context).pop();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Proof of Delivery', style: GoogleFonts.dmSans()),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black,
        elevation: 0,
      ),
      body: _isProcessing
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const CircularProgressIndicator(),
                    const SizedBox(height: 24),
                    Text(
                      _uploadStatus.isNotEmpty ? _uploadStatus : 'Processing...',
                      style: GoogleFonts.dmSans(fontSize: 16),
                      textAlign: TextAlign.center,
                    ),
                    if (_uploadProgress != null) ...[
                      const SizedBox(height: 16),
                      LinearProgressIndicator(value: _uploadProgress),
                    ],
                  ],
                ),
              ),
            )
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('1. Capture Photo of Goods', style: GoogleFonts.dmSans(fontSize: 16, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 10),
                  if (_capturedPhoto == null)
                    Container(
                      height: 250,
                      width: double.infinity,
                      decoration: BoxDecoration(color: Colors.grey[200], borderRadius: BorderRadius.circular(8)),
                      child: _cameraController != null && _cameraController!.value.isInitialized
                          ? ClipRRect(
                              borderRadius: BorderRadius.circular(8),
                              child: CameraPreview(_cameraController!),
                            )
                          : const Center(child: Text('Camera initializing...')),
                    )
                  else
                    ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: Image.file(File(_capturedPhoto!.path), height: 250, width: double.infinity, fit: BoxFit.cover),
                    ),
                  const SizedBox(height: 10),
                  Center(
                    child: ElevatedButton.icon(
                      onPressed: _capturedPhoto == null ? _takePhoto : () => setState(() => _capturedPhoto = null),
                      icon: Icon(_capturedPhoto == null ? Icons.camera_alt : Icons.refresh),
                      label: Text(_capturedPhoto == null ? 'Capture Photo' : 'Retake Photo'),
                      style: ElevatedButton.styleFrom(backgroundColor: TruxifyColors.accent),
                    ),
                  ),
                  const SizedBox(height: 30),
                  Text('2. Customer Signature', style: GoogleFonts.dmSans(fontSize: 16, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 10),
                  Container(
                    decoration: BoxDecoration(border: Border.all(color: Colors.grey), borderRadius: BorderRadius.circular(8)),
                    child: Signature(
                      controller: _signatureController,
                      height: 150,
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
                  const SizedBox(height: 30),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: _submit,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: TruxifyColors.primary,
                        padding: const EdgeInsets.symmetric(vertical: 16),
                      ),
                      child: Text('Complete Delivery', style: GoogleFonts.dmSans(fontSize: 16, fontWeight: FontWeight.bold)),
                    ),
                  )
                ],
              ),
            ),
    );
  }
}
