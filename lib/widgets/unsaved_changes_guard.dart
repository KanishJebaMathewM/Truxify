// lib/widgets/unsaved_changes_guard.dart

import 'package:flutter/material.dart';

class UnsavedChangesGuard extends StatelessWidget {
  final bool isDirty;
  final Widget child;
  final Future<bool?> Function()? onBackPressed;

  const UnsavedChangesGuard({
    Key? key,
    required this.isDirty,
    required this.child,
    this.onBackPressed,
  }) : super(key: key);

  Future<bool> _showDiscardDialog(BuildContext context) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('You have unsaved changes'),
        content: const Text('Are you sure you want to leave? Your changes will be lost.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false), // Stay
            child: const Text('Stay'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.of(context).pop(true), // Discard
            child: const Text('Discard'),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: !isDirty,
      onPopInvokedWithResult: (didPop, result) async {
        if (didPop) return;

        final shouldDiscard = await _showDiscardDialog(context);
        if (shouldDiscard && context.mounted) {
          if (onBackPressed != null) {
            await onBackPressed!();
          }
          Navigator.of(context).pop();
        }
      },
      child: child,
    );
  }
}
