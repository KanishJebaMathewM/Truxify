import 'package:flutter/material.dart';

class DesktopChatLayout extends StatefulWidget {
  const DesktopChatLayout({
    super.key,
    this.onSendMessage,
  });

  /// Connect this callback to Supabase Realtime / your chat service.
  final Future<void> Function(String conversationId, String message)?
      onSendMessage;

  @override
  State<DesktopChatLayout> createState() => _DesktopChatLayoutState();
}

class _DesktopChatLayoutState extends State<DesktopChatLayout> {
  final TextEditingController _messageController = TextEditingController();

  int _selectedConversation = 0;

  final List<_Conversation> _conversations = [
    _Conversation(
      id: 'driver',
      title: 'Driver Chat',
      subtitle: 'Rajesh • Truck #TN38AB1234',
      initials: 'DR',
      unread: 2,
      lastMessage: 'I will reach in 10 minutes.',
    ),
    _Conversation(
      id: 'support',
      title: 'Truxify Support',
      subtitle: 'Customer Support',
      initials: 'TS',
      unread: 0,
      lastMessage: 'How can we help you?',
    ),
    _Conversation(
      id: 'dispatcher',
      title: 'Dispatcher',
      subtitle: 'Operations Team',
      initials: 'DP',
      unread: 1,
      lastMessage: 'Shipment has been assigned.',
    ),
  ];

  final Map<String, List<_ChatMessage>> _messages = {
    'driver': [
      _ChatMessage(
        text: 'Hello! I have picked up your shipment.',
        isMe: false,
        time: '10:24 AM',
      ),
      _ChatMessage(
        text: 'Great. What is the estimated arrival time?',
        isMe: true,
        time: '10:25 AM',
      ),
      _ChatMessage(
        text: 'I will reach in around 10 minutes.',
        isMe: false,
        time: '10:26 AM',
      ),
    ],
    'support': [
      _ChatMessage(
        text: 'Hello! Welcome to Truxify Support.',
        isMe: false,
        time: '9:40 AM',
      ),
      _ChatMessage(
        text: 'How can we help you today?',
        isMe: false,
        time: '9:40 AM',
      ),
    ],
    'dispatcher': [
      _ChatMessage(
        text: 'Your shipment has been assigned to a driver.',
        isMe: false,
        time: '8:55 AM',
      ),
      _ChatMessage(
        text: 'Thank you for the update.',
        isMe: true,
        time: '8:57 AM',
      ),
    ],
  };

  @override
  void dispose() {
    _messageController.dispose();
    super.dispose();
  }

  _Conversation get _currentConversation =>
      _conversations[_selectedConversation];

  List<_ChatMessage> get _currentMessages =>
      _messages[_currentConversation.id] ?? [];

  Future<void> _sendMessage([String? predefinedMessage]) async {
    final message =
        (predefinedMessage ?? _messageController.text).trim();

    if (message.isEmpty) return;

    final conversationId = _currentConversation.id;

    setState(() {
      _messages[conversationId] ??= [];

      _messages[conversationId]!.add(
        _ChatMessage(
          text: message,
          isMe: true,
          time: _currentTime(),
        ),
      );

      _messageController.clear();
    });

    // Connect your Supabase realtime/send logic here.
    if (widget.onSendMessage != null) {
      await widget.onSendMessage!(conversationId, message);
    }
  }

  String _currentTime() {
    final now = TimeOfDay.now();

    final hour = now.hourOfPeriod == 0 ? 12 : now.hourOfPeriod;
    final minute = now.minute.toString().padLeft(2, '0');
    final period = now.period == DayPeriod.am ? 'AM' : 'PM';

    return '$hour:$minute $period';
  }

  void _showAttachmentMenu() {
    showModalBottomSheet<void>(
      context: context,
      builder: (context) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'Attach file',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 16),
                ListTile(
                  leading: const Icon(Icons.description_outlined),
                  title: const Text('Bill of Lading'),
                  onTap: () {
                    Navigator.pop(context);
                    _showAttachmentAdded('Bill of Lading');
                  },
                ),
                ListTile(
                  leading: const Icon(Icons.photo_outlined),
                  title: const Text('Photo'),
                  onTap: () {
                    Navigator.pop(context);
                    _showAttachmentAdded('Photo');
                  },
                ),
                ListTile(
                  leading: const Icon(Icons.attach_file),
                  title: const Text('Other document'),
                  onTap: () {
                    Navigator.pop(context);
                    _showAttachmentAdded('Document');
                  },
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  void _showAttachmentAdded(String type) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('$type attachment selected'),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isDesktop = constraints.maxWidth >= 800;

        if (!isDesktop) {
          return _buildMobileLayout();
        }

        return _buildDesktopLayout();
      },
    );
  }

  Widget _buildDesktopLayout() {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(
          color: Colors.grey.shade300,
        ),
        borderRadius: BorderRadius.circular(12),
      ),
      clipBehavior: Clip.antiAlias,
      child: Row(
        children: [
          SizedBox(
            width: 300,
            child: _buildConversationPane(),
          ),
          Container(
            width: 1,
            color: Colors.grey.shade300,
          ),
          Expanded(
            child: _buildMessagePane(),
          ),
        ],
      ),
    );
  }

  Widget _buildConversationPane() {
    return Column(
      children: [
        Container(
          height: 70,
          padding: const EdgeInsets.symmetric(
            horizontal: 20,
          ),
          alignment: Alignment.centerLeft,
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: Colors.grey.shade200,
              ),
            ),
          ),
          child: const Text(
            'Messages',
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.bold,
            ),
          ),
        ),

        Padding(
          padding: const EdgeInsets.all(12),
          child: TextField(
            decoration: InputDecoration(
              hintText: 'Search conversations',
              prefixIcon: const Icon(Icons.search),
              filled: true,
              fillColor: Colors.grey.shade100,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: BorderSide.none,
              ),
              contentPadding: EdgeInsets.zero,
            ),
          ),
        ),

        Expanded(
          child: ListView.builder(
            itemCount: _conversations.length,
            itemBuilder: (context, index) {
              final conversation = _conversations[index];
              final selected = index == _selectedConversation;

              return InkWell(
                onTap: () {
                  setState(() {
                    _selectedConversation = index;
                  });
                },
                child: Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: selected
                        ? Colors.blue.withOpacity(0.08)
                        : Colors.transparent,
                    border: selected
                        ? Border(
                            left: BorderSide(
                              color: Colors.blue,
                              width: 3,
                            ),
                          )
                        : null,
                  ),
                  child: Row(
                    children: [
                      CircleAvatar(
                        radius: 22,
                        child: Text(
                          conversation.initials,
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment:
                              CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    conversation.title,
                                    maxLines: 1,
                                    overflow:
                                        TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ),
                                if (conversation.unread > 0)
                                  Container(
                                    padding:
                                        const EdgeInsets.symmetric(
                                      horizontal: 6,
                                      vertical: 2,
                                    ),
                                    decoration: BoxDecoration(
                                      color: Colors.blue,
                                      borderRadius:
                                          BorderRadius.circular(10),
                                    ),
                                    child: Text(
                                      '${conversation.unread}',
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontSize: 10,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ),
                              ],
                            ),
                            const SizedBox(height: 4),
                            Text(
                              conversation.lastMessage,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: Colors.grey.shade600,
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  Widget _buildMessagePane() {
    return Column(
      children: [
        _buildChatHeader(),
        Expanded(
          child: _buildMessageArea(),
        ),
        _buildQuickReplies(),
        _buildMessageInput(),
      ],
    );
  }

  Widget _buildChatHeader() {
    return Container(
      height: 70,
      padding: const EdgeInsets.symmetric(
        horizontal: 22,
      ),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(
            color: Colors.grey.shade200,
          ),
        ),
      ),
      child: Row(
        children: [
          CircleAvatar(
            child: Text(
              _currentConversation.initials,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment:
                  CrossAxisAlignment.start,
              children: [
                Text(
                  _currentConversation.title,
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 16,
                  ),
                ),
                const SizedBox(height: 3),
                Row(
                  children: [
                    Container(
                      width: 8,
                      height: 8,
                      decoration: const BoxDecoration(
                        color: Colors.green,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 5),
                    Text(
                      _currentConversation.subtitle,
                      style: TextStyle(
                        color: Colors.grey.shade600,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'Search messages',
            icon: const Icon(Icons.search),
            onPressed: () {},
          ),
          IconButton(
            tooltip: 'More options',
            icon: const Icon(Icons.more_vert),
            onPressed: () {},
          ),
        ],
      ),
    );
  }

  Widget _buildMessageArea() {
    return DragTarget<String>(
      onAcceptWithDetails: (details) {
        _showAttachmentAdded(details.data);
      },
      builder: (
        context,
        candidateData,
        rejectedData,
      ) {
        final isDragging = candidateData.isNotEmpty;

        return Container(
          width: double.infinity,
          color: isDragging
              ? Colors.blue.withOpacity(0.05)
              : Colors.grey.shade50,
          child: Stack(
            children: [
              ListView.builder(
                padding: const EdgeInsets.all(24),
                itemCount: _currentMessages.length,
                itemBuilder: (context, index) {
                  return _buildMessageBubble(
                    _currentMessages[index],
                  );
                },
              ),

              if (isDragging)
                Positioned.fill(
                  child: Container(
                    color: Colors.blue.withOpacity(0.08),
                    child: Center(
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 30,
                          vertical: 24,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius:
                              BorderRadius.circular(14),
                          border: Border.all(
                            color: Colors.blue,
                            width: 2,
                          ),
                        ),
                        child: const Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              Icons.cloud_upload_outlined,
                              size: 42,
                              color: Colors.blue,
                            ),
                            SizedBox(height: 10),
                            Text(
                              'Drop your file here',
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            SizedBox(height: 4),
                            Text(
                              'Bill of Lading, photos or documents',
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildMessageBubble(_ChatMessage message) {
    return Align(
      alignment: message.isMe
          ? Alignment.centerRight
          : Alignment.centerLeft,
      child: Container(
        constraints: const BoxConstraints(
          maxWidth: 500,
        ),
        margin: const EdgeInsets.only(
          bottom: 14,
        ),
        padding: const EdgeInsets.symmetric(
          horizontal: 15,
          vertical: 11,
        ),
        decoration: BoxDecoration(
          color: message.isMe
              ? Colors.blue
              : Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: message.isMe
              ? null
              : Border.all(
                  color: Colors.grey.shade200,
                ),
        ),
        child: Column(
          crossAxisAlignment: message.isMe
              ? CrossAxisAlignment.end
              : CrossAxisAlignment.start,
          children: [
            Text(
              message.text,
              style: TextStyle(
                color: message.isMe
                    ? Colors.white
                    : Colors.black87,
                fontSize: 14,
              ),
            ),
            const SizedBox(height: 5),
            Text(
              message.time,
              style: TextStyle(
                color: message.isMe
                    ? Colors.white70
                    : Colors.grey.shade500,
                fontSize: 10,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildQuickReplies() {
    const replies = [
      'On my way',
      'Please send the update',
      'Thank you',
      'I will check',
    ];

    return Container(
      padding: const EdgeInsets.fromLTRB(
        16,
        8,
        16,
        4,
      ),
      alignment: Alignment.centerLeft,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: replies.map((reply) {
            return Padding(
              padding: const EdgeInsets.only(
                right: 8,
              ),
              child: ActionChip(
                label: Text(reply),
                onPressed: () {
                  _sendMessage(reply);
                },
              ),
            );
          }).toList(),
        ),
      ),
    );
  }

  Widget _buildMessageInput() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(
          top: BorderSide(
            color: Colors.grey.shade200,
          ),
        ),
      ),
      child: Row(
        crossAxisAlignment:
            CrossAxisAlignment.end,
        children: [
          IconButton(
            tooltip: 'Attach file',
            icon: const Icon(
              Icons.attach_file,
            ),
            onPressed: _showAttachmentMenu,
          ),

          Expanded(
            child: TextField(
              controller: _messageController,
              minLines: 1,
              maxLines: 5,
              textInputAction:
                  TextInputAction.newline,
              onSubmitted: (_) {
                _sendMessage();
              },
              decoration: InputDecoration(
                hintText: 'Type a message...',
                filled: true,
                fillColor: Colors.grey.shade100,
                border: OutlineInputBorder(
                  borderRadius:
                      BorderRadius.circular(12),
                  borderSide: BorderSide.none,
                ),
                contentPadding:
                    const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 12,
                ),
              ),
            ),
          ),

          const SizedBox(width: 8),

          IconButton(
            tooltip: 'Send message',
            onPressed: () {
              _sendMessage();
            },
            style: IconButton.styleFrom(
              backgroundColor: Colors.blue,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.all(13),
            ),
            icon: const Icon(
              Icons.send,
              size: 20,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMobileLayout() {
    return Column(
      children: [
        Container(
          height: 65,
          padding: const EdgeInsets.symmetric(
            horizontal: 16,
          ),
          child: Row(
            children: [
              IconButton(
                icon: const Icon(Icons.arrow_back),
                onPressed: () {},
              ),
              const SizedBox(width: 8),
              CircleAvatar(
                child: Text(
                  _currentConversation.initials,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  _currentConversation.title,
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: _buildMessageArea(),
        ),
        _buildQuickReplies(),
        _buildMessageInput(),
      ],
    );
  }
}

class _Conversation {
  final String id;
  final String title;
  final String subtitle;
  final String initials;
  final int unread;
  final String lastMessage;

  const _Conversation({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.initials,
    required this.unread,
    required this.lastMessage,
  });
}

class _ChatMessage {
  final String text;
  final bool isMe;
  final String time;

  const _ChatMessage({
    required this.text,
    required this.isMe,
    required this.time,
  });
}
