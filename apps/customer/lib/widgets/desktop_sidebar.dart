import 'package:flutter/material.dart';

class DesktopSidebar extends StatelessWidget {
  final int selectedIndex;
  final ValueChanged<int> onDestinationSelected;
  final bool isCollapsed;
  final VoidCallback onToggleCollapse;

  const DesktopSidebar({
    Key? key,
    required this.selectedIndex,
    required this.onDestinationSelected,
    required this.isCollapsed,
    required this.onToggleCollapse,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return AnimatedContainer(
      duration: const Duration(milliseconds: 200),
      width: isCollapsed ? 80 : 260,
      decoration: BoxDecoration(
        color: theme.cardColor,
        border: Border(
          right: BorderSide(color: theme.dividerColor.withOpacity(0.1)),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.03),
            blurRadius: 10,
            offset: const Offset(2, 0),
          ),
        ],
      ),
      child: Column(
        children: [
          // Branding Header & Collapse Toggle
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 20),
            child: Row(
              mainAxisAlignment:
                  isCollapsed ? MainAxisAlignment.center : MainAxisAlignment.spaceBetween,
              children: [
                if (!isCollapsed)
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: theme.primaryColor.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Icon(Icons.local_shipping, color: theme.primaryColor),
                      ),
                      const SizedBox(width: 12),
                      const Text(
                        'Truxify',
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.bold,
                          letterSpacing: 0.5,
                        ),
                      ),
                    ],
                  ),
                IconButton(
                  icon: Icon(isCollapsed ? Icons.menu_open : Icons.menu),
                  onPressed: onToggleCollapse,
                  tooltip: isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar',
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          const SizedBox(height: 12),

          // Navigation Items
          Expanded(
            child: ListView(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              children: [
                _buildNavItem(context, 0, 'Home', Icons.home_outlined, Icons.home),
                _buildNavItem(context, 1, 'Book Freight', Icons.add_box_outlined, Icons.add_box),
                _buildNavItem(context, 2, 'Active Shipments', Icons.local_shipping_outlined, Icons.local_shipping),
                _buildNavItem(context, 3, 'Order History', Icons.history, Icons.history),
                _buildNavItem(context, 4, 'Profile', Icons.person_outline, Icons.person),
              ],
            ),
          ),

          // Customer Quick-Profile Status Footer
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: Row(
              children: [
                const CircleAvatar(
                  radius: 18,
                  backgroundImage: NetworkImage(
                      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150'),
                ),
                if (!isCollapsed) ...[
                  const SizedBox(width: 12),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Joshua Miracle',
                          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                          overflow: TextOverflow.ellipsis,
                        ),
                        Text(
                          'Verified Customer',
                          style: TextStyle(color: Colors.grey, fontSize: 11),
                        ),
                      ],
                    ),
                  ),
                  const Icon(Icons.verified, size: 16, color: Colors.blue),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildNavItem(
      BuildContext context, int index, String label, IconData icon, IconData activeIcon) {
    final isSelected = selectedIndex == index;
    final theme = Theme.of(context);

    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(8),
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: () => onDestinationSelected(index),
          child: Container(
            padding: EdgeInsets.symmetric(
              vertical: 12,
              horizontal: isCollapsed ? 16 : 16,
            ),
            decoration: BoxDecoration(
              color: isSelected ? theme.primaryColor.withOpacity(0.1) : Colors.transparent,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              mainAxisAlignment:
                  isCollapsed ? MainAxisAlignment.center : MainAxisAlignment.start,
              children: [
                Icon(
                  isSelected ? activeIcon : icon,
                  color: isSelected ? theme.primaryColor : Colors.grey.shade600,
                  size: 22,
                ),
                if (!isCollapsed) ...[
                  const SizedBox(width: 16),
                  Text(
                    label,
                    style: TextStyle(
                      color: isSelected ? theme.primaryColor : Colors.grey.shade800,
                      fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                      fontSize: 14,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
