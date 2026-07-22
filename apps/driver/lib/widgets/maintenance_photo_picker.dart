import 'dart:io';

import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:image_picker/image_picker.dart';

import '../theme/app_theme.dart';

const int kMaxMaintenancePhotos = 3;
const int kMaxPhotoSizeBytes = 8 * 1024 * 1024; // 8 MB

class MaintenancePhotoPicker extends StatelessWidget {
  const MaintenancePhotoPicker({
    super.key,
    required this.selectedPhotos,
    required this.onPhotosChanged,
  });

  final List<XFile> selectedPhotos;
  final ValueChanged<List<XFile>> onPhotosChanged;

  Future<void> _pickImage(BuildContext context, ImageSource source) async {
    if (selectedPhotos.length >= kMaxMaintenancePhotos) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Maximum 3 photos allowed'),
          backgroundColor: TruxifyColors.warning,
        ),
      );
      return;
    }

    final picker = ImagePicker();
    final picked = await picker.pickImage(
      source: source,
      maxWidth: 1920,
      maxHeight: 1920,
      imageQuality: 85,
    );

    if (picked == null) return;

    // Validate file type
    final ext = picked.name.split('.').last.toLowerCase();
    if (!['jpg', 'jpeg', 'png'].contains(ext)) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Only JPEG and PNG images are supported'),
            backgroundColor: TruxifyColors.error,
          ),
        );
      }
      return;
    }

    // Validate file size
    final file = File(picked.path);
    final size = await file.length();
    if (size > kMaxPhotoSizeBytes) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Image must be smaller than 8 MB'),
            backgroundColor: TruxifyColors.error,
          ),
        );
      }
      return;
    }

    final updated = [...selectedPhotos, picked];
    onPhotosChanged(updated);
  }

  void _removePhoto(int index) {
    final updated = [...selectedPhotos]..removeAt(index);
    onPhotosChanged(updated);
  }

  void _showSourcePicker(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.camera_alt_rounded, color: TruxifyColors.accent),
              title: Text('Take Photo', style: GoogleFonts.dmSans()),
              onTap: () {
                Navigator.pop(ctx);
                _pickImage(context, ImageSource.camera);
              },
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_rounded, color: TruxifyColors.accent),
              title: Text('Choose from Gallery', style: GoogleFonts.dmSans()),
              onTap: () {
                Navigator.pop(ctx);
                _pickImage(context, ImageSource.gallery);
              },
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final canAddMore = selectedPhotos.length < kMaxMaintenancePhotos;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              'PHOTOS',
              style: GoogleFonts.dmSans(
                fontSize: 12,
                fontWeight: FontWeight.bold,
                color: TruxifyColors.adaptiveSecondaryText(context),
              ),
            ),
            Text(
              '${selectedPhotos.length}/$kMaxMaintenancePhotos',
              style: GoogleFonts.dmSans(
                fontSize: 11,
                color: TruxifyColors.hintText,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (selectedPhotos.isNotEmpty) ...[
          SizedBox(
            height: 80,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: selectedPhotos.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (context, index) {
                return Stack(
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: Image.file(
                        File(selectedPhotos[index].path),
                        width: 80,
                        height: 80,
                        fit: BoxFit.cover,
                      ),
                    ),
                    Positioned(
                      top: 2,
                      right: 2,
                      child: GestureDetector(
                        onTap: () => _removePhoto(index),
                        child: Container(
                          decoration: const BoxDecoration(
                            color: Colors.black54,
                            shape: BoxShape.circle,
                          ),
                          padding: const EdgeInsets.all(2),
                          child: const Icon(Icons.close, size: 14, color: Colors.white),
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
          const SizedBox(height: 8),
        ],
        if (canAddMore)
          GestureDetector(
            onTap: () => _showSourcePicker(context),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 14),
              decoration: BoxDecoration(
                border: Border.all(
                  color: Theme.of(context).brightness == Brightness.dark
                      ? TruxifyColors.darkBorder
                      : TruxifyColors.border,
                ),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.add_a_photo_rounded, size: 18, color: TruxifyColors.accent),
                  const SizedBox(width: 8),
                  Text(
                    'Attach Photos',
                    style: GoogleFonts.dmSans(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: TruxifyColors.accent,
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}
