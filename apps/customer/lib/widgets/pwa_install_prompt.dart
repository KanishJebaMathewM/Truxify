import 'package:flutter/material.dart';

class PwaInstallPrompt extends StatefulWidget {
  const PwaInstallPrompt({Key? key}) : super(key: key);

  @override
  State<PwaInstallPrompt> createState() => _PwaInstallPromptState();
}

class _PwaInstallPromptState extends State<PwaInstallPrompt> {
  bool _showInstallBanner = true;

  void _dismissBanner() {
    setState(() {
      _showInstallBanner = false;
    });
  }

  void _triggerInstall() {
    // Triggers browser native PWA installation prompt if available
    // (Handled via registered window beforeinstallprompt event in JS interop)
    setState(() {
      _showInstallBanner = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (!_showInstallBanner) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      color: const Color(0xFF1E293B),
      child: Row(
        children: [
          const Icon(Icons.get_app, color: Colors.blueAccent, size: 24),
          const SizedBox(width: 12),
          const Expanded(
            child: Text(
              'Install Truxify as a Desktop App for a faster, app-like experience.',
              style: TextStyle(color: Colors.white, fontSize: 14),
            ),
          ),
          TextButton(
            onPressed: _triggerInstall,
            style: TextButton.styleFrom(
              backgroundColor: Colors.blue,
              foregroundColor: Colors.white,
            ),
            child: const Text('Install'),
          ),
          const SizedBox(width: 8),
          IconButton(
            icon: const Icon(Icons.close, color: Colors.grey, size: 20),
            onPressed: _dismissBanner,
          ),
        ],
      ),
    );
  }
}
