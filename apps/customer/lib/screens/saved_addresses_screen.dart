import 'package:flutter/material.dart';

import '../models/saved_address.dart';
import '../repositories/address_repository.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';

class SavedAddressesScreen extends StatefulWidget {
  const SavedAddressesScreen({super.key});

  @override
  State<SavedAddressesScreen> createState() => _SavedAddressesScreenState();
}

class _SavedAddressesScreenState extends State<SavedAddressesScreen> {
  final _repo = AddressRepository();

  List<SavedAddress> _addresses = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final addresses = await _repo.fetchAll();
      if (mounted) setState(() => _addresses = addresses);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _setDefault(SavedAddress address) async {
    if (address.isDefault) return;
    try {
      await _repo.setDefault(address.id);
      await _load();
    } catch (e) {
      _showError('Failed to update default address.');
    }
  }

  Future<void> _delete(SavedAddress address) async {
    final confirmed = await _showDeleteConfirm(address.label);
    if (!confirmed) return;
    try {
      await _repo.delete(address.id);
      await _load();
    } catch (e) {
      _showError('Failed to delete address.');
    }
  }

  Future<void> _showAddDialog() async {
    final result = await showModalBottomSheet<SavedAddress>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _AddAddressSheet(),
    );
    if (result != null) {
      try {
        await _repo.add(result);
        await _load();
      } catch (e) {
        _showError('Failed to save address.');
      }
    }
  }

  Future<bool> _showDeleteConfirm(String label) async {
    return await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Delete Address'),
            content: Text('Remove "$label" from your saved addresses?'),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancel'),
              ),
              TextButton(
                onPressed: () => Navigator.pop(ctx, true),
                style: TextButton.styleFrom(foregroundColor: Colors.red),
                child: const Text('Delete'),
              ),
            ],
          ),
        ) ??
        false;
  }

  void _showError(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: Colors.red),
    );
  }

  IconData _iconForLabel(String label) {
    final l = label.toLowerCase();
    if (l.contains('home')) return Icons.home_rounded;
    if (l.contains('office') || l.contains('work')) return Icons.business_rounded;
    if (l.contains('warehouse')) return Icons.warehouse_rounded;
    return Icons.location_on_rounded;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Saved Addresses'),
        centerTitle: true,
        elevation: 0,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _ErrorView(message: _error!, onRetry: _load)
              : SingleChildScrollView(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (_addresses.isEmpty)
                        _EmptyState(onAdd: _showAddDialog)
                      else ...[
                        ListView.separated(
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          itemCount: _addresses.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 12),
                          itemBuilder: (context, index) {
                            final address = _addresses[index];
                            return _AddressCard(
                              address: address,
                              icon: _iconForLabel(address.label),
                              onTap: () => _setDefault(address),
                              onDelete: () => _delete(address),
                            );
                          },
                        ),
                        const SizedBox(height: 28),
                        OutlinedButton.icon(
                          onPressed: _showAddDialog,
                          icon: const Icon(Icons.add_location_rounded),
                          label: const Text('Add New Address'),
                        ),
                        const SizedBox(height: 20),
                        PrimaryButton(
                          label: 'Done',
                          onPressed: () => Navigator.of(context).pop(),
                        ),
                      ],
                    ],
                  ),
                ),
    );
  }
}

// ── Address card ─────────────────────────────────────────────────────────────

class _AddressCard extends StatelessWidget {
  const _AddressCard({
    required this.address,
    required this.icon,
    required this.onTap,
    required this.onDelete,
  });

  final SavedAddress address;
  final IconData icon;
  final VoidCallback onTap;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final isDefault = address.isDefault;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          border: Border.all(
            color: isDefault
                ? TruxifyColors.accent
                : (isDark ? TruxifyColors.darkBorder : TruxifyColors.border),
            width: isDefault ? 2 : 1,
          ),
          borderRadius: BorderRadius.circular(12),
          color: isDefault
              ? TruxifyColors.accent.withValues(alpha: 0.08)
              : Theme.of(context).colorScheme.surface,
        ),
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: TruxifyColors.accentLight,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(icon, color: TruxifyColors.accent, size: 22),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        address.label,
                        style: Theme.of(context).textTheme.labelMedium?.copyWith(
                              fontWeight: FontWeight.w600,
                            ),
                      ),
                      if (isDefault) ...[
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: TruxifyColors.accent.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            'Default',
                            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                                  color: TruxifyColors.accent,
                                  fontWeight: FontWeight.w600,
                                ),
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    address.fullAddress,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: TruxifyColors.adaptiveSecondaryText(context),
                        ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            if (isDefault)
              const Icon(Icons.check_circle_rounded, color: TruxifyColors.accent, size: 24)
            else
              IconButton(
                icon: const Icon(Icons.delete_outline_rounded, size: 20),
                color: Colors.red.shade400,
                onPressed: onDelete,
                tooltip: 'Delete',
              ),
          ],
        ),
      ),
    );
  }
}

// ── Add address bottom sheet ──────────────────────────────────────────────────

class _AddAddressSheet extends StatefulWidget {
  const _AddAddressSheet();

  @override
  State<_AddAddressSheet> createState() => _AddAddressSheetState();
}

class _AddAddressSheetState extends State<_AddAddressSheet> {
  final _formKey = GlobalKey<FormState>();
  final _labelCtrl = TextEditingController();
  final _lineCtrl = TextEditingController();
  final _cityCtrl = TextEditingController();
  final _stateCtrl = TextEditingController();
  final _pincodeCtrl = TextEditingController();
  bool _setAsDefault = false;
  bool _saving = false;

  @override
  void dispose() {
    _labelCtrl.dispose();
    _lineCtrl.dispose();
    _cityCtrl.dispose();
    _stateCtrl.dispose();
    _pincodeCtrl.dispose();
    super.dispose();
  }

  void _submit() {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);

    // We don't have userId here — the repository's requireUserId handles it.
    // Pass a placeholder; the repo fills user_id from auth.
    final address = SavedAddress(
      id: '',
      userId: '',
      label: _labelCtrl.text.trim(),
      addressLine: _lineCtrl.text.trim(),
      city: _cityCtrl.text.trim(),
      state: _stateCtrl.text.trim(),
      pincode: _pincodeCtrl.text.trim(),
      isDefault: _setAsDefault,
    );

    Navigator.of(context).pop(address);
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.of(context).viewInsets.bottom;

    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
      ),
      padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + bottom),
      child: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Text('Add New Address',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                const Spacer(),
                IconButton(
                  icon: const Icon(Icons.close_rounded),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
            const SizedBox(height: 16),
            _Field(ctrl: _labelCtrl, label: 'Label', hint: 'e.g. Home, Office, Warehouse'),
            const SizedBox(height: 12),
            _Field(ctrl: _lineCtrl, label: 'Address Line', hint: 'Street / building / area'),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: _Field(ctrl: _cityCtrl, label: 'City', hint: 'City')),
              const SizedBox(width: 12),
              Expanded(child: _Field(ctrl: _stateCtrl, label: 'State', hint: 'State')),
            ]),
            const SizedBox(height: 12),
            _Field(
              ctrl: _pincodeCtrl,
              label: 'Pincode',
              hint: '6-digit pincode',
              keyboardType: TextInputType.number,
              validator: (v) {
                if (v == null || v.trim().isEmpty) return 'Required';
                if (v.trim().length != 6) return 'Must be 6 digits';
                return null;
              },
            ),
            const SizedBox(height: 8),
            SwitchListTile.adaptive(
              value: _setAsDefault,
              onChanged: (v) => setState(() => _setAsDefault = v),
              title: const Text('Set as default address'),
              contentPadding: EdgeInsets.zero,
              activeThumbColor: TruxifyColors.accent,
            ),
            const SizedBox(height: 12),
            PrimaryButton(
              label: _saving ? 'Saving…' : 'Save Address',
              onPressed: _saving ? null : _submit,
            ),
          ],
        ),
      ),
    );
  }
}

class _Field extends StatelessWidget {
  const _Field({
    required this.ctrl,
    required this.label,
    required this.hint,
    this.keyboardType,
    this.validator,
  });

  final TextEditingController ctrl;
  final String label;
  final String hint;
  final TextInputType? keyboardType;
  final String? Function(String?)? validator;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: ctrl,
      keyboardType: keyboardType,
      decoration: InputDecoration(labelText: label, hintText: hint),
      validator: validator ?? (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
    );
  }
}

// ── Empty state ───────────────────────────────────────────────────────────────

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.onAdd});
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        const SizedBox(height: 60),
        Icon(Icons.location_off_rounded, size: 64, color: TruxifyColors.adaptiveSecondaryText(context)),
        const SizedBox(height: 16),
        Text('No saved addresses',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        Text('Add an address to get started.',
            style: Theme.of(context)
                .textTheme
                .bodyMedium
                ?.copyWith(color: TruxifyColors.adaptiveSecondaryText(context))),
        const SizedBox(height: 32),
        OutlinedButton.icon(
          onPressed: onAdd,
          icon: const Icon(Icons.add_location_rounded),
          label: const Text('Add New Address'),
        ),
      ],
    );
  }
}

// ── Error view ────────────────────────────────────────────────────────────────

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline_rounded, size: 48, color: Colors.red),
            const SizedBox(height: 12),
            Text('Something went wrong', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(message,
                style: Theme.of(context).textTheme.bodySmall,
                textAlign: TextAlign.center),
            const SizedBox(height: 20),
            OutlinedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}