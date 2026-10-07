import 'package:flutter/material.io.dart'; // standard material
import 'package:flutter/material.dart';

class DesktopChatLayout extends StatelessWidget {
  final List<Map<String, dynamic>> conversations;
  final String? selectedConversationId;
  final ValueChanged<String> onSelectConversation;
  final List<Map<String, dynamic>> messages;
  final TextEditingController messageController;
  final VoidCallback onSendMessage;
  final ValueChanged<List<dynamic>> onFilesDropped;
  final String activeTitle;
  final String activeSubtitle;

  const DesktopChatLayout({
    Key? key,
    required this.conversations,
    required this.selectedConversationId,
    required this.onSelectConversation,
    required this.messages,
    required this.messageController,
    required this.onSendMessage,
    required this.onFilesDropped,
    required this.activeTitle,
    required this.activeSubtitle,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      body: Row(
        children: [
          // Left Pane: Conversation List (300px fixed width)
          Container(
            width: 300,
            decoration: BoxDecoration(
              color: theme.cardColor,
              border: Border(
                right: BorderSide(color: theme.dividerColor, width: 1),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Text(
                    'Conversations',
                    style: theme.textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                const Divider(height: 1),
                Expanded(
                  child: ListView.builder(
                    itemCount: conversations.length,
                    itemBuilder: (context, index) {
                      final chat = conversations[index];
                      final isSelected = chat['id'] == selectedConversationId;

                      return ListTile(
                        selected: isSelected,
                        selectedTileColor: theme.primaryColor.withOpacity(0.1),
                        leading: CircleAvatar(
                          backgroundImage: chat['avatar'] != null
                              ? NetworkImage(chat['avatar'])
                              : null,
                          child: chat['avatar'] == null
                              ? Text(chat['name'][0])
                              : null,
                        ),
                        title: Text(
                          chat['name'],
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        subtitle: Text(
                          chat['lastMessage'] ?? '',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        onTap: () => onSelectConversation(chat['id']),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),

          // Right Pane: Active Message Stream & Input with Drag-and-Drop
          Expanded(
            child: DragTarget<List<dynamic>>(
              onAccept: (files) => onFilesDropped(files),
              builder: (context, candidateData, rejectedData) {
                return Column(
                  children: [
                    // Chat Header
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 24, vertical: 16),
                      decoration: BoxDecoration(
                        color: theme.cardColor,
                        border: Border(
                          bottom: BorderSide(color: theme.dividerColor, width: 1),
                        ),
                      ),
                      child: Row(
                        children: [
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                activeTitle,
                                style: theme.textTheme.titleMedium
                                    ?.copyWith(fontWeight: FontWeight.bold),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                activeSubtitle,
                                style: theme.textTheme.bodySmall,
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),

                    // Message List Stream
                    Expanded(
                      child: ListView.builder(
                        padding: const EdgeInsets.all(24),
                        itemCount: messages.length,
                        itemBuilder: (context, index) {
                          final msg = messages[index];
                          final isMe = msg['isMe'] == true;

                          return Align(
                            alignment: isMe
                                ? Alignment.centerRight
                                : Alignment.centerLeft,
                            child: Container(
                              margin: const EdgeInsets.symmetric(vertical: 6),
                              padding: const EdgeInsets.all(12),
                              constraints: const BoxConstraints(maxWidth: 500),
                              decoration: BoxDecoration(
                                color: isMe
                                    ? theme.primaryColor
                                    : theme.colorScheme.surfaceVariant,
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Text(
                                msg['text'] ?? '',
                                style: TextStyle(
                                  color: isMe
                                      ? theme.colorScheme.onPrimary
                                      : theme.colorScheme.onSurfaceVariant,
                                ),
                              ),
                            ),
                          );
                        },
                      ),
                    ),

                    // Quick Canned Responses
                    Container(
                      height: 48,
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: ListView(
                        scrollDirection: Axis.horizontal,
                        children: [
                          ActionChip(
                            label: const Text('Where is my driver?'),
                            onPressed: () {
                              messageController.text =
                                  'Can you provide an update on my driver location?';
                            },
                          ),
                          const SizedBox(width: 8),
                          ActionChip(
                            label: const Text('Request Bill of Lading'),
                            onPressed: () {
                              messageController.text =
                                  'Could you please attach the signed Bill of Lading?';
                            },
                          ),
                          const SizedBox(width: 8),
                          ActionChip(
                            label: const Text('Report Delay'),
                            onPressed: () {
                              messageController.text =
                                  'We are experiencing a transit delay due to traffic.';
                            },
                          ),
                        ],
                      ),
                    ),

                    // Message Input & Attachment Area
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: theme.cardColor,
                        border: Border(
                          top: BorderSide(color: theme.dividerColor, width: 1),
                        ),
                      ),
                      child: Row(
                        children: [
                          IconButton(
                            icon: const Icon(Icons.attach_file),
                            tooltip: 'Attach Bill of Lading or Photos',
                            onPressed: () {
                              // Trigger file picker implementation
                            },
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: TextField(
                              controller: messageController,
                              decoration: const InputDecoration(
                                hintText:
                                    'Type a message or drag & drop files here...',
                                border: OutlineInputBorder(),
                                contentPadding: EdgeInsets.symmetric(
                                    horizontal: 16, vertical: 12),
                              ),
                              onSubmitted: (_) => onSendMessage(),
                            ),
                          ),
                          const SizedBox(width: 8),
                          IconButton.filled(
                            icon: const Icon(Icons.send),
                            onPressed: onSendMessage,
                          ),
                        ],
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
