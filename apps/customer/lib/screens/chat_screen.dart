import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../widgets/chat/desktop_chat_layout.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({Key? key}) : super(key: key);

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final SupabaseClient _supabase = Supabase.instance.client;
  final TextEditingController _messageController = TextEditingController();
  
  List<Map<String, dynamic>> _conversations = [];
  String? _selectedConversationId;
  List<Map<String, dynamic>> _messages = [];
  RealtimeChannel? _chatChannel;

  @override
  void initState() {
    super.initState();
    _loadConversations();
  }

  Future<void> _loadConversations() async {
    // Fetch active shipment conversations / support threads
    final response = await _supabase
        .from('conversations')
        .select()
        .order('updated_at', ascending: false);

    setState(() {
      _conversations = List<Map<String, dynamic>>.from(response);
      if (_conversations.isNotEmpty && _selectedConversationId == null) {
        _selectedConversationId = _conversations.first['id'];
        _subscribeToMessages(_selectedConversationId!);
      }
    });
  }

  void _subscribeToMessages(String conversationId) async {
    // Fetch initial messages
    final data = await _supabase
        .from('messages')
        .select()
        .eq('conversation_id', conversationId)
        .order('created_at', ascending: true);

    setState(() {
      _messages = List<Map<String, dynamic>>.from(data);
    });

    // Supabase Realtime subscription
    _chatChannel?.unsubscribe();
    _chatChannel = _supabase.channel('public:messages:conversation_id=eq.$conversationId')
      ..onPostgresChanges(
        event: PostgresChangeEvent.insert,
        schema: 'public',
        table: 'messages',
        filter: PostgresChangeFilter(
          type: PostgresChangeFilterType.eq,
          column: 'conversation_id',
          value: conversationId,
        ),
        callback: (payload) {
          setState(() {
            _messages.add(payload.newRecord);
          });
        },
      )
      .subscribe();
  }

  void _sendMessage() async {
    if (_messageController.text.trim().isEmpty || _selectedConversationId == null) return;
    
    final text = _messageController.text.trim();
    _messageController.clear();

    await _supabase.from('messages').insert({
      'conversation_id': _selectedConversationId,
      'text': text,
      'isMe': true,
      'created_at': DateTime.now().toIso8601String(),
    });
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isDesktop = constraints.maxWidth >= 900;

        if (isDesktop) {
          final activeChat = _conversations.firstWhere(
            (c) => c['id'] == _selectedConversationId,
            orElse: () => {'name': 'Select Chat', 'subtitle': ''},
          );

          return DesktopChatLayout(
            conversations: _conversations,
            selectedConversationId: _selectedConversationId,
            onSelectConversation: (id) {
              setState(() => _selectedConversationId = id);
              _subscribeToMessages(id);
            },
            messages: _messages,
            messageController: _messageController,
            onSendMessage: _sendMessage,
            onFilesDropped: (files) {
              // Handle dropped attachments (e.g., BOL PDF / Photos)
            },
            activeTitle: activeChat['name'] ?? 'Chat',
            activeSubtitle: activeChat['subtitle'] ?? 'Active Shipment Thread',
          );
        }

        // Mobile fallback view
        return Scaffold(
          appBar: AppBar(title: const Text('Customer Chat')),
          body: const Center(child: Text('Mobile Chat View')),
        );
      },
    );
  }

  @override
  void dispose() {
    _chatChannel?.unsubscribe();
    _messageController.dispose();
    super.dispose();
  }
}
