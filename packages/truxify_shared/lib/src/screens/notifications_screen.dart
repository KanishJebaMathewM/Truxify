import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../models/notification_item.dart';
import '../repositories/notification_repository.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key, required this.userId, required this.repository, this.title = 'Notifications'});

  final String userId;
  final String title;
  final NotificationRepository repository;

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  bool _loading = true;
  String? _error;
  List<NotificationItem> _items = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final items = await widget.repository.fetchNotifications(widget.userId);
      if (!mounted) return;
      setState(() => _items = items);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _markRead(NotificationItem item) async {
    await widget.repository.markNotificationRead(item.id);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title), centerTitle: true),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text('Failed to load notifications'))
              : _items.isEmpty
                  ? const Center(child: Text('No notifications yet'))
                  : ListView.separated(
                      padding: const EdgeInsets.all(16),
                      itemCount: _items.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 12),
                      itemBuilder: (context, index) {
                        final item = _items[index];
                        return ListTile(
                          tileColor: item.isRead ? null : Theme.of(context).colorScheme.primaryContainer.withValues(alpha: 0.25),
                          leading: Icon(Icons.notifications_rounded, color: item.isRead ? null : Theme.of(context).colorScheme.primary),
                          title: Text(item.title),
                          subtitle: Text('${item.body}\n${item.createdAt == null ? '' : DateFormat('dd MMM, hh:mm a').format(item.createdAt!.toLocal())}'),
                          isThreeLine: true,
                          trailing: item.isRead
                              ? const Icon(Icons.done_rounded)
                              : TextButton(onPressed: () => _markRead(item), child: const Text('Mark read')),
                        );
                      },
                    ),
    );
  }
}

