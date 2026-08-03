import 'dart:io';
import 'package:flutter/material.dart';
import 'package:camera/camera.dart';
import 'package:signature/signature.dart';
import 'package:path_provider/path_provider.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:geolocator/geolocator.dart';
import 'package:truxify_shared/truxify_shared.dart';
import '../services/sync_service.dart';
import '../services/trip_service.dart';

class ProofOfDeliveryScreen extends StatefulWidget {
  final String tripDisplayId;
  final String stopId;
  final String? orderId;
  final String? earnings;
  final Future<void> Function(String? photoPath, String? signaturePath)? onComplete;

  const ProofOfDeliveryScreen({
    Key? key,
    required this.tripDisplayId,
    required this.stopId,
    this.orderId,
    this.earnings,
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
    final tripService = TripService();

    try {
      // 1. If orderId is provided, attempt payment release via geofence or OTP manual entry
      if (widget.orderId != null) {
        _updateStatus('Checking GPS Geofence status...');
        double? lat;
        double? lng;
        try {
          final position = await Geolocator.getCurrentPosition(
            desiredAccuracy: LocationAccuracy.high,
            timeLimit: const Duration(seconds: 4),
          );
          lat = position.latitude;
          lng = position.longitude;
        } catch (e) {
          debugPrint('Geolocator error: $e');
        }

        bool paymentReleased = false;
        String? successMsg;

        // Try geofence auto-release first
        try {
          final res = await tripService.confirmOtp(
            orderId: widget.orderId!,
            latitude: lat,
            longitude: lng,
          );
          if (res['payment_released'] == true) {
            paymentReleased = true;
            successMsg = res['message'] ?? 'Delivery auto-confirmed via GPS Geofence!';
          }
        } catch (e) {
          debugPrint('Geofence auto-confirm failed: $e');
        }

        // If geofence failed, request manual OTP
        if (!paymentReleased) {
          _updateStatus('Awaiting OTP verification...');
          final enteredOtp = await showDialog<String>(
            context: context,
            barrierDismissible: false,
            builder: (context) => const _DriverOtpEntryDialog(),
          );

          if (enteredOtp == null || enteredOtp.isEmpty) {
            setState(() => _isProcessing = false);
            _updateStatus('');
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Delivery confirmation cancelled. OTP required.')),
              );
            }
            return;
          }

          _updateStatus('Verifying OTP and releasing funds...');
          try {
            final res = await tripService.confirmOtp(
              orderId: widget.orderId!,
              otp: enteredOtp,
            );
            if (res['payment_released'] == true) {
              paymentReleased = true;
              successMsg = res['message'] ?? 'OTP Verified!';
            }
          } catch (e) {
            setState(() => _isProcessing = false);
            _updateStatus('');
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text('OTP verification failed: $e')),
              );
            }
            return;
          }
        }

        // Show successful release notification
        if (paymentReleased && mounted) {
          final displayEarnings = widget.earnings ?? 'payout';
          await showDialog<void>(
            context: context,
            builder: (context) => Dialog(
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
              child: Padding(
                padding: const EdgeInsets.all(24.0),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.verified_user_rounded, color: Colors.green, size: 64),
                    const SizedBox(height: 16),
                    Text(
                      'Payment Released! ✓',
                      textAlign: TextAlign.center,
                      style: GoogleFonts.dmSans(
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                        color: Colors.green,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      '₹$displayEarnings has been credited to your wallet.',
                      textAlign: TextAlign.center,
                      style: GoogleFonts.dmSans(
                        fontSize: 15,
                        color: TruxifyColors.hintText,
                      ),
                    ),
                    const SizedBox(height: 24),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                        style: FilledButton.styleFrom(
                          backgroundColor: Colors.green,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                        onPressed: () => Navigator.of(context).pop(),
                        child: const Text('OK'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        }
      }

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
    } finally {
      tripService.dispose();
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

class _DriverOtpEntryDialog extends StatefulWidget {
  const _DriverOtpEntryDialog();

  @override
  State<_DriverOtpEntryDialog> createState() => _DriverOtpEntryDialogState();
}

class _DriverOtpEntryDialogState extends State<_DriverOtpEntryDialog> {
  final List<TextEditingController> _controllers = List.generate(4, (_) => TextEditingController());
  final List<FocusNode> _focusNodes = List.generate(4, (_) => FocusNode());

  @override
  void dispose() {
    for (final controller in _controllers) {
      controller.dispose();
    }
    for (final node in _focusNodes) {
      node.dispose();
    }
    super.dispose();
  }

  String _getOtp() {
    return _controllers.map((c) => c.text).join();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const Icon(Icons.lock_person_rounded, color: TruxifyColors.accent, size: 28),
                const SizedBox(width: 12),
                Text(
                  'Enter Delivery OTP',
                  style: GoogleFonts.dmSans(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              'Please enter the 4-digit OTP provided by the customer to release payment.',
              style: GoogleFonts.dmSans(
                fontSize: 14,
                color: TruxifyColors.hintText,
              ),
            ),
            const SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: List.generate(4, (index) {
                return SizedBox(
                  width: 50,
                  child: TextField(
                    controller: _controllers[index],
                    focusNode: _focusNodes[index],
                    autofocus: index == 0,
                    keyboardType: TextInputType.number,
                    textAlign: TextAlign.center,
                    maxLength: 1,
                    style: GoogleFonts.dmSans(
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                    ),
                    decoration: InputDecoration(
                      counterText: '',
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: const BorderSide(color: TruxifyColors.accent, width: 2),
                      ),
                    ),
                    onChanged: (value) {
                      if (value.isNotEmpty && index < 3) {
                        _focusNodes[index + 1].requestFocus();
                      } else if (value.isEmpty && index > 0) {
                        _focusNodes[index - 1].requestFocus();
                      }
                      if (_getOtp().length == 4) {
                        // Submit automatically when 4 digits are entered
                        Navigator.of(context).pop(_getOtp());
                      }
                    },
                  ),
                );
              }),
            ),
            const SizedBox(height: 28),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Cancel', style: TextStyle(color: Colors.grey)),
                ),
                const SizedBox(width: 12),
                FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: TruxifyColors.accent,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  onPressed: () {
                    Navigator.of(context).pop(_getOtp());
                  },
                  child: const Text('Verify', style: TextStyle(fontWeight: FontWeight.w700)),
                ),
              ],
            )
          ],
        ),
      ),
    );
  }
}

