import 'package:flutter/material.dart';

class DesktopSettingsScreen extends StatefulWidget {
  const DesktopSettingsScreen({super.key});

  @override
  State<DesktopSettingsScreen> createState() => _DesktopSettingsScreenState();
}

class _DesktopSettingsScreenState extends State<DesktopSettingsScreen> {
  int _selectedTabIndex = 0;

  // Controllers for Profile / Business KYC
  final _nameController = TextEditingController(text: 'Joshua Miracle J');
  final _emailController = TextEditingController(text: 'joshua.miracle@truxify.com');
  final _phoneController = TextEditingController(text: '+91 98765 43210');
  final _gstinController = TextEditingController(text: '33AAAAA0000A1Z5');
  final _formKey = GlobalKey<FormState>();

  // Mock Saved Warehouses & Addresses
  final List<Map<String, dynamic>> _addresses = [
    {
      'title': 'Primary Warehouse (Chennai Hub)',
      'address': 'SIPCOT IT Park, Siruseri, Chennai, Tamil Nadu 603103',
      'isDefault': true,
    },
    {
      'title': 'Secondary Distribution Center',
      'address': 'Ambattur Industrial Estate, Chennai, Tamil Nadu 600058',
      'isDefault': false,
    },
  ];

  // Mock Payment Methods
  final List<Map<String, dynamic>> _paymentMethods = [
    {'type': 'Escrow Wallet', 'details': 'Balance: ₹1,45,000 (Active)', 'isDefault': true},
    {'type': 'Corporate Credit Card', 'details': 'HDFC Bank ending in •••• 4092', 'isDefault': false},
  ];

  int selectedIndex = 0;

  final List<String> sections = [
    'Profile & Business KYC',
    'Saved Addresses',
    'Payment & Invoicing',
    'Notifications & Language',
  ];

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      body: Row(
        children: [
          // Left Sidebar: Vertical Navigation Tabs (260px)
          Container(
            width: 260,
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
                  padding: const EdgeInsets.all(24.0),
                  child: Text(
                    'Settings Center',
                    style: theme.textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                const Divider(height: 1),
                _buildNavItem(0, Icons.person_outline, 'General Profile & KYC'),
                _buildNavItem(1, Icons.location_on_outlined, 'Saved Warehouses'),
                _buildNavItem(2, Icons.payment_outlined, 'Payments & Escrow'),
                _buildNavItem(3, Icons.notifications_outlined, 'Notifications & Lang'),
              ],
            ),
          ),

          // Right Content Area
          Expanded(
            child: Container(
              color: theme.colorScheme.background,
              child: Padding(
                padding: const EdgeInsets.all(32.0),
                child: _buildSelectedTabContent(),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildNavItem(int index, IconData icon, String label) {
    final isSelected = _selectedTabIndex == index;
    final theme = Theme.of(context);

    return ListTile(
      leading: Icon(icon, color: isSelected ? theme.primaryColor : null),
      title: Text(
        label,
        style: TextStyle(
          fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
          color: isSelected ? theme.primaryColor : null,
        ),
      ),
      selected: isSelected,
      selectedTileColor: theme.primaryColor.withOpacity(0.08),
      onTap: () => setState(() => _selectedTabIndex = index),
    );
  }

  Widget _buildSelectedTabContent() {
    switch (_selectedTabIndex) {
      case 0:
        return _buildProfileAndKycTab();
      case 1:
        return _buildSavedAddressesTab();
      case 2:
        return _buildPaymentMethodsTab();
      case 3:
        return _buildNotificationsTab();
      default:
        return Container();
    }
  }

  // Tab 0: General Profile & Business KYC
  Widget _buildProfileAndKycTab() {
    return SingleChildScrollView(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 700),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('General Profile & Business KYC', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              const Text('Manage your corporate identity and tax compliance information.'),
              const SizedBox(height: 24),
              TextFormField(
                controller: _nameController,
                decoration: const InputDecoration(labelText: 'Full Name / Representative', border: OutlineInputBorder()),
                validator: (val) => val == null || val.isEmpty ? 'Name cannot be empty' : null,
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: TextFormField(
                      controller: _emailController,
                      decoration: const InputDecoration(labelText: 'Corporate Email', border: OutlineInputBorder()),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: TextFormField(
                      controller: _phoneController,
                      decoration: const InputDecoration(labelText: 'Phone Number', border: OutlineInputBorder()),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _gstinController,
                decoration: const InputDecoration(labelText: 'GSTIN / Business Tax ID', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 24),
              ElevatedButton.icon(
                onPressed: () {
                  if (_formKey.currentState!.validate()) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Profile settings updated successfully!')),
                    );
                  }
                },
                icon: const Icon(Icons.save),
                label: const Text('Save Changes'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // Tab 1: Saved Warehouses & Frequent Addresses (2-Column Grid)
  Widget _buildSavedAddressesTab() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Saved Warehouses & Addresses', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold)),
                const SizedBox(height: 4),
                const Text('Manage pickup and delivery hubs for quick shipment booking.'),
              ],
            ),
            ElevatedButton.icon(
              onPressed: _showAddAddressModal,
              icon: const Icon(Icons.add),
              label: const Text('Add Address'),
            ),
          ],
        ),
        const SizedBox(height: 24),
        Expanded(
          child: GridView.builder(
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              crossAxisSpacing: 16,
              mainAxisSpacing: 16,
              childAspectRatio: 2.2,
            ),
            itemCount: _addresses.length,
            itemBuilder: (context, index) {
              final addr = _addresses[index];
              return Card(
                elevation: 1,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                child: Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(addr['title'], style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                          if (addr['isDefault'])
                            Chip(label: const Text('Default', style: TextStyle(fontSize: 10)), backgroundColor: Colors.green.shade100),
                        ],
                      ),
                      Text(addr['address'], maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: Colors.grey.shade700)),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          TextButton(
                            onPressed: () {},
                            child: const Text('Edit'),
                          ),
                        ],
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

  // Modal Dialog with Pin-on-Map Confirmation for Adding Addresses
  void _showAddAddressModal() {
    final titleController = TextEditingController();
    final addressController = TextEditingController();

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Add New Warehouse / Address'),
        content: SizedBox(
          width: 500,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: titleController,
                decoration: const InputDecoration(labelText: 'Location Title (e.g., North Hub)', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: addressController,
                decoration: const InputDecoration(labelText: 'Street Address, City, Postal Code', border: OutlineInputBorder()),
                maxLines: 2,
              ),
              const SizedBox(height: 16),
              // Simulated Pin-on-Map Confirmation Widget
              Container(
                height: 150,
                decoration: BoxDecoration(
                  color: Colors.grey.shade200,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: Colors.grey.shade400),
                ),
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    const Center(child: Text('Map View: Pin Exact Geofence Coordinates', style: TextStyle(color: Colors.grey))),
                    const Icon(Icons.location_pin, color: Colors.red, size: 36),
                  ],
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () {
              if (titleController.text.isNotEmpty && addressController.text.isNotEmpty) {
                setState(() {
                  _addresses.add({
                    'title': titleController.text,
                    'address': addressController.text,
                    'isDefault': false,
                  });
                });
                Navigator.pop(context);
              }
            },
            child: const Text('Confirm & Save'),
          ),
        ],
      ),
    );
  }

  // Tab 2: Payment Methods & Escrow Wallets
  Widget _buildPaymentMethodsTab() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Payment Methods, Escrow Wallets & Invoicing', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        const Text('Manage corporate wallets, credit lines, and billing preferences.'),
        const SizedBox(height: 24),
        Expanded(
          child: ListView.builder(
            itemCount: _paymentMethods.length,
            itemBuilder: (context, index) {
              final pm = _paymentMethods[index];
              return Card(
                margin: const EdgeInsets.only(bottom: 12),
                child: ListTile(
                  leading: const Icon(Icons.account_balance_wallet, size: 32),
                  title: Text(pm['type'], style: const TextStyle(fontWeight: FontWeight.bold)),
                  subtitle: Text(pm['details']),
                  trailing: pm['isDefault'] 
                      ? const Chip(label: Text('Primary')) 
                      : TextButton(onPressed: () {}, child: const Text('Set as Primary')),
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  // Tab 3: Notification Preferences & Language Selection
  Widget _buildNotificationsTab() {
    return const Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Notification & Language Settings', style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
        SizedBox(height: 16),
        SwitchListTile(
          title: Text('Real-Time Shipment SMS Alerts'),
          subtitle: Text('Receive dispatch updates and driver arrival pins via SMS'),
          value: true,
          onChanged: null,
        ),
        SwitchListTile(
          title: Text('Escrow & Invoicing Email Summaries'),
          subtitle: Text('Receive automated PDF invoices upon delivery confirmation'),
          value: true,
          onChanged: null,
        ),
      ],
    );
  }

  // ------------------------------------------------------------
  // PROFILE
  // ------------------------------------------------------------

  // ------------------------------------------------------------
  // ADDRESSES
  // ------------------------------------------------------------

  // ------------------------------------------------------------
  // PAYMENT
  // ------------------------------------------------------------

  // ------------------------------------------------------------
  // NOTIFICATIONS
  // ------------------------------------------------------------

  // ------------------------------------------------------------
  // COMMON WIDGETS
  // ------------------------------------------------------------

}
