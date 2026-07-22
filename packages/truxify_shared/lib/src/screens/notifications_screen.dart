import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/notification_item.dart';
import '../repositories/notification_repository.dart';
import '../services/notification_router.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key, required this.userId, required this.repository, this.title = 'Notifications', this.onNotificationTap});
  const NotificationsScreen({
    super.key,
    required this.userId,
    required this.repository,
    this.title = 'Notifications',
    this.onItemTap,
  });

  final String userId;
  final String title;
  final NotificationRepository repository;
  final void Function(NotificationItem item)? onNotificationTap;

  /// Called when a notification [ListTile] is tapped.
  /// Receives the tapped item and should perform navigation.
  final ValueChanged<NotificationItem>? onItemTap;

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  bool _loading = true;
  String? _error;
  List<NotificationItem> _items = [];
  RealtimeChannel? _channel;

  @override
  void initState() {
    super.initState();
    _load();
    _subscribeRealtime();
  }

  @override
  void dispose() {
    if (_channel != null) {
      Supabase.instance.client.removeChannel(_channel!);
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final items = await widget.repository.fetchNotifications(widget.userId);
      if (!mounted) return;
      setState(() {
        _items = items;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _subscribeRealtime() {
    _channel = Supabase.instance.client
        .channel('notifications_${widget.userId}')
        .onPostgresChanges(
          event: PostgresChangeEvent.insert,
          schema: 'public',
          table: 'notifications',
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: 'user_id',
            value: widget.userId,
          ),
          callback: (payload) {
            final item = NotificationItem.fromMap(
              payload.newRecord,
            );

            if (_items.any((e) => e.id == item.id)) {
              return;
            }

            if (!mounted) return;

            setState(() {
              _items.insert(0, item);
            });
          },
        )
        .subscribe();
  }

  Future<void> _markRead(NotificationItem item) async {
    try {
      await widget.repository.markNotificationRead(item.id, widget.userId);

      if (!mounted) return;

      setState(() {
        _items = _items.map((n) {
          if (n.id == item.id) return n.copyWith(isRead: true);
          return n;
        }).toList();
      });
    } catch (_) {
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Failed to mark notification as read'),
        ),
      );
    }
  }

  void _onTileTap(NotificationItem item) async {
    // Mark as read if unread.
    if (!item.isRead) await _markRead(item);
    // Delegate navigation to the parent.
    widget.onItemTap?.call(item);
  }

  int get _unreadCount => _items.where((item) => !item.isRead).length;

  String _formatRelativeTime(DateTime? dateTime) {
    if (dateTime == null) return '';

    final now = DateTime.now();
    final diff = now.difference(dateTime.toLocal());

    if (diff.isNegative || diff.inSeconds < 60) return 'Just now';
    if (diff.inMinutes < 60) {
      final minutes = diff.inMinutes;
      return '${minutes} minute${minutes == 1 ? '' : 's'} ago';
    }
    if (diff.inHours < 24) {
      final hours = diff.inHours;
      return '${hours} hour${hours == 1 ? '' : 's'} ago';
    }
    if (diff.inDays == 1) return 'Yesterday';
    if (diff.inDays < 7) {
      final days = diff.inDays;
      return '${days} days ago';
    }
    final weeks = diff.inDays ~/ 7;
    if (weeks < 5) {
      return '${weeks} week${weeks == 1 ? '' : 's'} ago';
    }
    final years = diff.inDays ~/ 365;
    if (years > 0) {
      return '${years} year${years == 1 ? '' : 's'} ago';
    }
    final months = diff.inDays ~/ 30;
    return '${months} month${months == 1 ? '' : 's'} ago';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        centerTitle: true,
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: Center(
              child: Badge(
                isLabelVisible: _unreadCount > 0,
                label: Text(_unreadCount.toString()),
                child: const Icon(Icons.notifications_rounded),
              ),
            ),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: _loading
            ? ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: const [
                  SizedBox(height: 250),
                  Center(child: CircularProgressIndicator()),
                ],
              )
            : _error != null
                ? ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    children: const [
                      SizedBox(height: 250),
                      Center(child: Text('Failed to load notifications')),
                    ],
                  )
                : _items.isEmpty
                    ? ListView(
                        physics: const AlwaysScrollableScrollPhysics(),
                        children: const [
                          SizedBox(height: 250),
                          Center(child: Text('No notifications yet')),
                        ],
                      )
                    : ListView.separated(
                        padding: const EdgeInsets.all(16),
                        physics: const AlwaysScrollableScrollPhysics(),
                        itemCount: _items.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 12),
                        itemBuilder: (context, index) {
                          final item = _items[index];
                          final relativeTime = _formatRelativeTime(item.createdAt);
                          return ListTile(
                            onTap: () => _onTileTap(item),
                            tileColor: item.isRead ? null : Theme.of(context).colorScheme.primaryContainer.withValues(alpha: 0.25),
                            leading: Icon(Icons.notifications_rounded, color: item.isRead ? null : Theme.of(context).colorScheme.primary),
                            title: Text(item.title),
                            subtitle: Text(
                              [
                                item.body,
                                if (relativeTime.isNotEmpty) relativeTime,
                              ].join('\n'),
                            ),
                            isThreeLine: true,
                            onTap: () {
                              if (!item.isRead) _markRead(item);
                              widget.onNotificationTap?.call(item);
                            },
                            trailing: item.isRead
                                ? const Icon(Icons.done_rounded)
                                : TextButton(
                                    onPressed: () => _markRead(item),
                                    child: const Text('Mark read'),
                                  ),
                          );
                        },
                      ),
      ),
    );
  }
}


