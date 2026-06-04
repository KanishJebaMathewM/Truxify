import 'package:flutter/material.dart';

class OrderSearchBar extends StatelessWidget {
  final String title;
  final bool isSearching;
  final VoidCallback onToggle;
  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final String searchQuery;
  final String hintText;

  const OrderSearchBar({
    super.key,
    required this.title,
    required this.isSearching,
    required this.onToggle,
    required this.controller,
    required this.onChanged,
    required this.searchQuery,
    this.hintText = 'Search',
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Text(title, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
              const Spacer(),
              IconButton(
                onPressed: onToggle,
                icon: Icon(isSearching ? Icons.close_rounded : Icons.search_rounded),
              ),
            ],
          ),
          if (isSearching)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: TextField(
                controller: controller,
                autofocus: true,
                onChanged: onChanged,
                decoration: InputDecoration(
                  hintText: hintText,
                  prefixIcon: const Icon(Icons.search_rounded),
                  suffixIcon: searchQuery.isEmpty
                      ? null
                      : IconButton(
                          icon: const Icon(Icons.close_rounded),
                          onPressed: () {
                            controller.clear();
                            onChanged('');
                          },
                        ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
