import 'package:flutter/material.dart';

class RecentRouteAction extends StatelessWidget {
  const RecentRouteAction({
    super.key,
    required this.onPressed,
  });

  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      onPressed: onPressed,
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, 42),
        padding: const EdgeInsets.symmetric(horizontal: 14),
      ),
      child: const Text('Rebook'),
    );
  }
}
