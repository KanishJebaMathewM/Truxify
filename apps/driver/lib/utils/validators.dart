import 'package:flutter/services.dart';

class UpperCaseTextFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    return TextEditingValue(
      text: newValue.text.toUpperCase(),
      selection: newValue.selection,
    );
  }
}

String? validateRegistrationNumber(String? value) {
  if (value == null || value.trim().isEmpty) {
    return 'Registration number is required';
  }

  final RegExp regex = RegExp(r'^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$');
  
  if (!regex.hasMatch(value)) {
    return 'Enter a valid RTO number (e.g., DL01AA1234)';
  }

  return null;
}
