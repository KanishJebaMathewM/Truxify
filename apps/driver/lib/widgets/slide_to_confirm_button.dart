import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../theme/app_theme.dart';

class SlideToConfirmButton extends StatefulWidget {
  const SlideToConfirmButton({
    super.key,
    required this.label,
    required this.onConfirmed,
    this.backgroundColor = TruxifyColors.accent,
    this.foregroundColor = Colors.white,
  });

  final String label;
  final VoidCallback onConfirmed;
  final Color backgroundColor;
  final Color foregroundColor;

  @override
  State<SlideToConfirmButton> createState() => _SlideToConfirmButtonState();
}

class _SlideToConfirmButtonState extends State<SlideToConfirmButton> {
  double _dragProgress = 0.0;
  bool _confirmed = false;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final double maxDragWidth =
            constraints.maxWidth - 50; 
        return Container(
          height: 52,
          width: double.infinity,
          decoration: BoxDecoration(
            color: widget.backgroundColor.withOpacity(0.08),
            borderRadius: BorderRadius.circular(26),
            border: Border.all(color: widget.backgroundColor.withOpacity(0.2)),
          ),
          child: Stack(
            children: [
              Center(
                child: Opacity(
                  opacity: (1.0 - _dragProgress).clamp(0.2, 1.0),
                  child: Text(
                    widget.label,
                    style: GoogleFonts.dmSans(
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      color: widget.backgroundColor,
                    ),
                  ),
                ),
              ),
              Positioned(
                left: _dragProgress * maxDragWidth + 3,
                top: 3,
                bottom: 3,
                child: GestureDetector(
                  onHorizontalDragUpdate: (details) {
                    if (_confirmed) return;
                    setState(() {
                      _dragProgress =
                          (_dragProgress + (details.delta.dx / maxDragWidth))
                              .clamp(0.0, 1.0);
                    });
                  },
                  onHorizontalDragEnd: (details) {
                    if (_confirmed) return;
                    if (_dragProgress >= 0.9) {
                      setState(() {
                        _dragProgress = 1.0;
                        _confirmed = true;
                      });
                      widget.onConfirmed();
                      Future.delayed(const Duration(milliseconds: 500), () {
                        if (mounted) {
                          setState(() {
                            _dragProgress = 0.0;
                            _confirmed = false;
                          });
                        }
                      });
                    } else {
                      setState(() {
                        _dragProgress = 0.0;
                      });
                    }
                  },
                  child: Container(
                    width: 46,
                    height: 46,
                    decoration: BoxDecoration(
                      color: widget.backgroundColor,
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(
                          color: widget.backgroundColor.withOpacity(0.3),
                          blurRadius: 6,
                          offset: const Offset(0, 2),
                        ),
                      ],
                    ),
                    child: Icon(
                      _confirmed
                          ? Icons.check_rounded
                          : Icons.chevron_right_rounded,
                      color: widget.foregroundColor,
                      size: 20,
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}