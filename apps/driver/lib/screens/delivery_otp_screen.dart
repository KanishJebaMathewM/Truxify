import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

// Assuming TruxifyColors is defined in your project
// class TruxifyColors {
//   static const Color accentDark = Color(0xFF1E1E1E);
// }

class DeliveryOtpScreen extends StatefulWidget {
  const DeliveryOtpScreen({super.key});

  @override
  State<DeliveryOtpScreen> createState() => _DeliveryOtpScreenState();
}

class _DeliveryOtpScreenState extends State<DeliveryOtpScreen> {
  final String _otp = '';
  final bool _isVerifying = false;

  void _confirmOtp() {
    // TODO: Implement confirmation logic
  }

  void _clearOtp() {
    setState(() {
      // TODO: Implement clear logic
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          'Verify OTP',
          style: GoogleFonts.dmSans(fontWeight: FontWeight.bold),
        ),
      ),
      body: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // Example OTP input placeholder / display area
            Text(
              'Enter the 6-digit OTP sent to the customer',
              style: GoogleFonts.dmSans(fontSize: 14, color: Colors.grey[700]),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            
            // ── Confirm button ────────────────────────────────────────────────
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                key: const Key('btn_confirm_delivery_otp'),
                onPressed: (_isVerifying || _otp.length < 6)
                    ? null
                    : _confirmOtp,
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.black8Gh, // Replace with TruxifyColors.accentDark if available
                  foregroundColor: Colors.white,
                  disabledBackgroundColor: Colors.black.withValues(alpha: 0.4),
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14)),
                  elevation: 3,
                ),
                child: _isVerifying
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white),
                      )
                    : Text(
                        'Confirm Delivery',
                        style: GoogleFonts.dmSans(
                            fontSize: 16, fontWeight: FontWeight.w700),
                      ),
              ),
            ),
            const SizedBox(height: 12),

            // ── Clear button ──────────────────────────────────────────────────
            Center(
              child: TextButton.icon(
                key: const Key('btn_clear_otp'),
                onPressed: _clearOtp,
                icon: const Icon(Icons.backspace_outlined, size: 16),
                label: Text(
                  'Clear OTP',
                  style: GoogleFonts.dmSans(fontSize: 13),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
