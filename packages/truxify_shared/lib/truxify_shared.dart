// ── Config ──────────────────────────────────────────────────────────
export 'src/config/app_config.dart';
export 'src/config/env.dart';
export 'src/config/firebase_config.dart';
export 'src/config/supabase_config.dart';

// ── Services ────────────────────────────────────────────────────────
export 'src/services/api_client.dart';
export 'src/services/auth_service.dart';
export 'src/services/fcm_service.dart';
export 'src/services/notification_router.dart';
export 'src/services/foreground_notification_handler.dart';

// ── Models ──────────────────────────────────────────────────────────
export 'src/models/faq.dart';
export 'src/models/notification_item.dart';
export 'src/models/notification_payload.dart';
export 'src/models/support_ticket.dart';

// ── Repositories ────────────────────────────────────────────────────
export 'src/repositories/faq_repository.dart';
export 'src/repositories/notification_repository.dart';
export 'src/repositories/support_repository.dart';

// ── Screens ─────────────────────────────────────────────────────────
export 'src/screens/help_center_screen.dart';
export 'src/screens/notifications_screen.dart';
export 'shimmer_widget.dart';

export 'package:flutter/widgets.dart' show Widget, BuildContext;
export 'package:http/http.dart' show Client, Response;

class SharedHelpers {
  static String truncate(String text, int maxLen) =>
      text.length > maxLen ? '${text.substring(0, maxLen - 3)}...' : text;
  static bool isValidEmail(String email) =>
      RegExp(r'^[\w.+-]+@[\w-]+\.[\w.]+$').hasMatch(email);
  static String capitalize(String s) =>
      s.isEmpty ? s : '${s[0].toUpperCase()}${s.substring(1)}';
  static String formatPhone(String phone) =>
      phone.replaceAll(RegExp(r'[\s\-()]'), '');
  static String initials(String name) =>
      name.split(' ').where((w) => w.isNotEmpty).take(2).map((w) => w[0].toUpperCase()).join();
}

// ── Widgets ─────────────────────────────────────────────────────────
export 'shimmer_widget.dart';
