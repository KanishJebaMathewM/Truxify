import 'package:flutter/material.dart';

class DesktopSettingsScreen extends StatefulWidget {
  const DesktopSettingsScreen({Key? key}) : super(key: key);
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
          mainAxisAlignment: MainAxisAlignment.between,
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
                        mainAxisAlignment: MainAxisAlignment.between,
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
    return Scaffold(
      backgroundColor: const Color(0xFFF7F8FA),
      appBar: AppBar(
        elevation: 0,
        backgroundColor: Colors.white,
        foregroundColor: Colors.black87,
        title: const Text(
          'Settings',
          style: TextStyle(
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      body: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _buildSidebar(),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: _buildContent(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSidebar() {
    return Container(
      width: 270,
      color: Colors.white,
      padding: const EdgeInsets.symmetric(
        vertical: 24,
        horizontal: 16,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.symmetric(
              horizontal: 16,
              vertical: 8,
            ),
            child: Text(
              'Account Settings',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: Colors.grey,
              ),
            ),
          ),
          const SizedBox(height: 8),
          ...List.generate(
            sections.length,
            (index) => _buildNavigationItem(
              index,
              sections[index],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildNavigationItem(
    int index,
    String title,
  ) {
    final bool isSelected = selectedIndex == index;

    final icons = [
      Icons.person_outline,
      Icons.location_on_outlined,
      Icons.payment_outlined,
      Icons.notifications_none,
    ];

    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Material(
        color: isSelected
            ? Theme.of(context).colorScheme.primary.withOpacity(0.10)
            : Colors.transparent,
        borderRadius: BorderRadius.circular(10),
        child: InkWell(
          borderRadius: BorderRadius.circular(10),
          onTap: () {
            setState(() {
              selectedIndex = index;
            });
          },
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: 14,
              vertical: 13,
            ),
            child: Row(
              children: [
                Icon(
                  icons[index],
                  size: 21,
                  color: isSelected
                      ? Theme.of(context).colorScheme.primary
                      : Colors.grey.shade700,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    title,
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: isSelected
                          ? FontWeight.w600
                          : FontWeight.w400,
                      color: isSelected
                          ? Theme.of(context).colorScheme.primary
                          : Colors.grey.shade800,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildContent() {
    switch (selectedIndex) {
      case 0:
        return _buildProfileSection();
      case 1:
        return _buildAddressSection();
      case 2:
        return _buildPaymentSection();
      case 3:
        return _buildNotificationSection();
      default:
        return const SizedBox();
    }
  }

  Widget _buildPageHeader(
    String title,
    String subtitle,
  ) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(
            fontSize: 26,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          subtitle,
          style: TextStyle(
            fontSize: 14,
            color: Colors.grey.shade600,
          ),
        ),
        const SizedBox(height: 28),
      ],
    );
  }

  // ------------------------------------------------------------
  // PROFILE
  // ------------------------------------------------------------

  Widget _buildProfileSection() {
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildPageHeader(
            'Profile & Business KYC',
            'Manage your personal and business information.',
          ),
          _buildSettingsCard(
            title: 'Personal Information',
            children: [
              _buildEditableRow(
                'Full Name',
                'Your Name',
              ),
              _buildEditableRow(
                'Email',
                'your@email.com',
              ),
              _buildEditableRow(
                'Phone Number',
                '+91 XXXXX XXXXX',
              ),
            ],
          ),
          const SizedBox(height: 20),
          _buildSettingsCard(
            title: 'Business & KYC',
            children: [
              _buildEditableRow(
                'Business Name',
                'Your Business',
              ),
              _buildEditableRow(
                'GST Number',
                'Not provided',
              ),
              _buildEditableRow(
                'Business Address',
                'Not provided',
              ),
              _buildEditableRow(
                'KYC Status',
                'Pending Verification',
                editable: false,
              ),
            ],
          ),
        ],
      ),
    );
  }

  // ------------------------------------------------------------
  // ADDRESSES
  // ------------------------------------------------------------

  Widget _buildAddressSection() {
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: _buildPageHeader(
                  'Saved Warehouses & Addresses',
                  'Manage frequently used pickup and delivery locations.',
                ),
              ),
              ElevatedButton.icon(
                onPressed: _showAddAddressDialog,
                icon: const Icon(Icons.add),
                label: const Text('Add Address'),
              ),
            ],
          ),
          LayoutBuilder(
            builder: (context, constraints) {
              final width = constraints.maxWidth;

              final cardWidth = width > 900
                  ? (width - 20) / 2
                  : width;

              return Wrap(
                spacing: 20,
                runSpacing: 20,
                children: [
                  SizedBox(
                    width: cardWidth,
                    child: _buildAddressCard(
                      title: 'Main Warehouse',
                      address:
                          'Chennai, Tamil Nadu',
                      type: 'Warehouse',
                    ),
                  ),
                  SizedBox(
                    width: cardWidth,
                    child: _buildAddressCard(
                      title: 'Office',
                      address:
                          'Guindy, Chennai, Tamil Nadu',
                      type: 'Frequent Address',
                    ),
                  ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _buildAddressCard({
    required String title,
    required String address,
    required String type,
  }) {
    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(
          color: Colors.grey.shade200,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: Theme.of(context)
                        .colorScheme
                        .primary
                        .withOpacity(0.10),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(
                    Icons.location_on_outlined,
                    color: Theme.of(context).colorScheme.primary,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    title,
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 16,
                    ),
                  ),
                ),
                PopupMenuButton<String>(
                  onSelected: (value) {
                    if (value == 'edit') {
                      _showAddAddressDialog(
                        existingTitle: title,
                        existingAddress: address,
                      );
                    }
                  },
                  itemBuilder: (context) => const [
                    PopupMenuItem(
                      value: 'edit',
                      child: Text('Edit'),
                    ),
                    PopupMenuItem(
                      value: 'delete',
                      child: Text('Delete'),
                    ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 18),
            Text(
              type,
              style: TextStyle(
                fontSize: 12,
                color: Colors.grey.shade600,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              address,
              style: const TextStyle(
                fontSize: 14,
              ),
            ),
            const SizedBox(height: 18),
            OutlinedButton.icon(
              onPressed: () {
                _showMapConfirmation(address);
              },
              icon: const Icon(Icons.map_outlined),
              label: const Text('View / Confirm on Map'),
            ),
          ],
        ),
      ),
    );
  }

  void _showAddAddressDialog({
    String? existingTitle,
    String? existingAddress,
  }) {
    final titleController = TextEditingController(
      text: existingTitle ?? '',
    );

    final addressController = TextEditingController(
      text: existingAddress ?? '',
    );

    final formKey = GlobalKey<FormState>();

    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: Text(
            existingTitle == null
                ? 'Add Address'
                : 'Edit Address',
          ),
          content: SizedBox(
            width: 520,
            child: Form(
              key: formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextFormField(
                    controller: titleController,
                    decoration: const InputDecoration(
                      labelText: 'Address Name',
                      hintText: 'Example: Main Warehouse',
                      border: OutlineInputBorder(),
                    ),
                    validator: (value) {
                      if (value == null || value.trim().isEmpty) {
                        return 'Please enter an address name';
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: addressController,
                    maxLines: 3,
                    decoration: const InputDecoration(
                      labelText: 'Address',
                      hintText: 'Enter complete address',
                      border: OutlineInputBorder(),
                    ),
                    validator: (value) {
                      if (value == null || value.trim().isEmpty) {
                        return 'Please enter the address';
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: 16),
                  Container(
                    height: 130,
                    width: double.infinity,
                    decoration: BoxDecoration(
                      color: Colors.grey.shade100,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: Colors.grey.shade300,
                      ),
                    ),
                    child: Center(
                      child: Column(
                        mainAxisAlignment:
                            MainAxisAlignment.center,
                        children: [
                          Icon(
                            Icons.location_on,
                            size: 34,
                            color: Theme.of(context)
                                .colorScheme
                                .primary,
                          ),
                          const SizedBox(height: 6),
                          const Text(
                            'Pin location on map',
                            style: TextStyle(
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'Map confirmation area',
                            style: TextStyle(
                              color: Colors.grey.shade600,
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.pop(context);
              },
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: () {
                if (formKey.currentState!.validate()) {
                  Navigator.pop(context);

                  ScaffoldMessenger.of(this.context)
                      .showSnackBar(
                    SnackBar(
                      content: Text(
                        existingTitle == null
                            ? 'Address added successfully'
                            : 'Address updated successfully',
                      ),
                    ),
                  );
                }
              },
              child: const Text('Save Address'),
            ),
          ],
        );
      },
    );
  }

  void _showMapConfirmation(String address) {
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('Confirm Location'),
          content: SizedBox(
            width: 500,
            height: 300,
            child: Column(
              children: [
                Expanded(
                  child: Container(
                    width: double.infinity,
                    decoration: BoxDecoration(
                      color: Colors.grey.shade100,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Center(
                      child: Icon(
                        Icons.location_on,
                        size: 50,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  address,
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Close'),
            ),
            ElevatedButton(
              onPressed: () {
                Navigator.pop(context);
                ScaffoldMessenger.of(this.context)
                    .showSnackBar(
                  const SnackBar(
                    content: Text(
                      'Location confirmed',
                    ),
                  ),
                );
              },
              child: const Text('Confirm Location'),
            ),
          ],
        );
      },
    );
  }

  // ------------------------------------------------------------
  // PAYMENT
  // ------------------------------------------------------------

  Widget _buildPaymentSection() {
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildPageHeader(
            'Payment & Invoicing',
            'Manage payment methods, escrow wallets and billing details.',
          ),
          _buildSettingsCard(
            title: 'Payment Methods',
            children: [
              _buildPaymentMethod(
                icon: Icons.credit_card,
                title: 'Business Card',
                subtitle: '**** **** **** 1234',
              ),
              _buildPaymentMethod(
                icon: Icons.account_balance,
                title: 'Bank Account',
                subtitle: 'XXXX XXXX 5678',
              ),
              Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton.icon(
                  onPressed: () {},
                  icon: const Icon(Icons.add),
                  label: const Text('Add Payment Method'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          _buildSettingsCard(
            title: 'Escrow Wallet',
            children: [
              _buildEditableRow(
                'Available Balance',
                '₹0.00',
                editable: false,
              ),
              _buildEditableRow(
                'Wallet Status',
                'Active',
                editable: false,
              ),
            ],
          ),
          const SizedBox(height: 20),
          _buildSettingsCard(
            title: 'Invoicing Details',
            children: [
              _buildEditableRow(
                'Billing Name',
                'Your Business',
              ),
              _buildEditableRow(
                'GSTIN',
                'Not provided',
              ),
              _buildEditableRow(
                'Billing Email',
                'billing@email.com',
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildPaymentMethod({
    required IconData icon,
    required String title,
    required String subtitle,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Row(
        children: [
          Icon(
            icon,
            size: 26,
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  subtitle,
                  style: TextStyle(
                    color: Colors.grey.shade600,
                    fontSize: 13,
                  ),
                ),
              ],
            ),
          ),
          TextButton(
            onPressed: () {},
            child: const Text('Manage'),
          ),
        ],
      ),
    );
  }

  // ------------------------------------------------------------
  // NOTIFICATIONS
  // ------------------------------------------------------------

  Widget _buildNotificationSection() {
    bool pushNotifications = true;
    bool emailNotifications = true;
    bool loadUpdates = true;
    bool paymentUpdates = true;

    return StatefulBuilder(
      builder: (context, setLocalState) {
        return SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildPageHeader(
                'Notifications & Language',
                'Control how you receive account and shipment updates.',
              ),
              _buildSettingsCard(
                title: 'Notification Preferences',
                children: [
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Push Notifications'),
                    subtitle: const Text(
                      'Receive notifications on your device.',
                    ),
                    value: pushNotifications,
                    onChanged: (value) {
                      setLocalState(() {
                        pushNotifications = value;
                      });
                    },
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Email Notifications'),
                    subtitle: const Text(
                      'Receive important updates by email.',
                    ),
                    value: emailNotifications,
                    onChanged: (value) {
                      setLocalState(() {
                        emailNotifications = value;
                      });
                    },
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Load Updates'),
                    subtitle: const Text(
                      'Get updates about your active loads.',
                    ),
                    value: loadUpdates,
                    onChanged: (value) {
                      setLocalState(() {
                        loadUpdates = value;
                      });
                    },
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Payment Updates'),
                    subtitle: const Text(
                      'Receive payment and invoice notifications.',
                    ),
                    value: paymentUpdates,
                    onChanged: (value) {
                      setLocalState(() {
                        paymentUpdates = value;
                      });
                    },
                  ),
                ],
              ),
              const SizedBox(height: 20),
              _buildSettingsCard(
                title: 'Language',
                children: [
                  DropdownButtonFormField<String>(
                    value: 'English',
                    decoration: const InputDecoration(
                      labelText: 'App Language',
                      border: OutlineInputBorder(),
                    ),
                    items: const [
                      DropdownMenuItem(
                        value: 'English',
                        child: Text('English'),
                      ),
                      DropdownMenuItem(
                        value: 'Tamil',
                        child: Text('Tamil'),
                      ),
                    ],
                    onChanged: (value) {},
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  // ------------------------------------------------------------
  // COMMON WIDGETS
  // ------------------------------------------------------------

  Widget _buildSettingsCard({
    required String title,
    required List<Widget> children,
  }) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: Colors.grey.shade200,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 20),
          ...children,
        ],
      ),
    );
  }

  Widget _buildEditableRow(
    String label,
    String value, {
    bool editable = true,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Row(
        children: [
          Expanded(
            flex: 2,
            child: Text(
              label,
              style: TextStyle(
                color: Colors.grey.shade600,
                fontSize: 13,
              ),
            ),
          ),
          Expanded(
            flex: 4,
            child: Text(
              value,
              style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          if (editable)
            TextButton(
              onPressed: () {
                _showEditDialog(label, value);
              },
              child: const Text('Edit'),
            ),
        ],
      ),
    );
  }

  void _showEditDialog(
    String label,
    String value,
  ) {
    final controller = TextEditingController(
      text: value,
    );

    final formKey = GlobalKey<FormState>();

    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: Text('Edit $label'),
          content: SizedBox(
            width: 450,
            child: Form(
              key: formKey,
              child: TextFormField(
                controller: controller,
                autofocus: true,
                decoration: InputDecoration(
                  labelText: label,
                  border: const OutlineInputBorder(),
                ),
                validator: (value) {
                  if (value == null ||
                      value.trim().isEmpty) {
                    return '$label cannot be empty';
                  }
                  return null;
                },
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: () {
                if (formKey.currentState!.validate()) {
                  Navigator.pop(context);

                  ScaffoldMessenger.of(this.context)
                      .showSnackBar(
                    SnackBar(
                      content: Text(
                        '$label updated successfully',
                      ),
                    ),
                  );
                }
              },
              child: const Text('Save'),
            ),
          ],
        );
      },
    );
  }
}
