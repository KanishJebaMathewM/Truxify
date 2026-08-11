import 'package:flutter/material.dart';

class Breakpoints {
  static const double xl = 840;
  static bool isXL(BuildContext context) =>
      MediaQuery.of(context).size.width >= xl;
}
