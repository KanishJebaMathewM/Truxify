import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

class TextScaleProvider extends ChangeNotifier {
  static const String _prefKey = 'ui_scale_preference';
  bool _isLargeText = false;

  bool get isLargeText => _isLargeText;

  TextScaleProvider() {
    _loadPreference();
  }

  Future<void> _loadPreference() async {
    final prefs = await SharedPreferences.getInstance();
    _isLargeText = prefs.getBool(_prefKey) ?? false;
    notifyListeners();
  }

  Future<void> toggleScale(bool value) async {
    _isLargeText = value;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_prefKey, value);
    notifyListeners();
  }
}
