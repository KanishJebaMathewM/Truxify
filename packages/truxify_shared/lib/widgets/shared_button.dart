import 'package:flutter/material.dart';

class SharedButton extends StatelessWidget {
  final String text;
  final VoidCallback onPressed;

  const SharedButton({Key? key, required this.text, required this.onPressed}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return ElevatedButton(
      onPressed: onPressed,
      child: Text(text),
    );
  }
}
