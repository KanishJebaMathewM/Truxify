import 'package:flutter/material.dart';

import '../models/payment_method.dart';
import '../repositories/payment_repository.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';

class PaymentMethodsScreen extends StatefulWidget {
  const PaymentMethodsScreen({super.key});

  @override
  State<PaymentMethodsScreen> createState() => _PaymentMethodsScreenState();
}

class _PaymentMethodsScreenState extends State<PaymentMethodsScreen> {
  final _repo = PaymentRepository();

  List<PaymentMethod> _methods = [];
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
      final methods = await _repo.fetchAll();
      if (mounted) setState(() => _methods = methods);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _setDefault(PaymentMethod method) async {
    if (method.isDefault) return;
    try {
      await _repo.setDefault(method.id);
      await _load();
    } catch (e) {
      _showError('Failed to update default payment method.');
    }
  }

  Future<void> _delete(PaymentMethod method) async {
    final confirmed = await _showDeleteConfirm(method.displayLabel);
    if (!confirmed) return;
    try {
      await _repo.delete(method.id);
      await _load();
    } catch (e) {
      _showError('Failed to remove payment method.');
    }
  }

  Future<void> _showAddDialog() async {
    final result = await showModalBottomSheet<PaymentMethod>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _AddPaymentSheet(),
    );
    if (result != null) {
      try {
        await _repo.add(result);
        await _load();
      } catch (e) {
        _showError('Failed to add payment method.');
      }
    }
  }

  Future<bool> _showDeleteConfirm(String label) async {
    return await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Remove Payment Method'),
            content: Text('Remove "$label" from your saved methods?'),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancel'),
              ),
              TextButton(
                onPressed: () => Navigator.pop(ctx, true),
                style: TextButton.styleFrom(foregroundColor: Colors.red),
                child: const Text('Remove'),
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Payment Methods'),
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
                      if (_methods.isEmpty)
                        _EmptyState(onAdd: _showAddDialog)
                      else ...[
                        ListView.separated(
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          itemCount: _methods.length,
                          separatorBuilder: (_, __) =>
                              const SizedBox(height: 12),
                          itemBuilder: (context, index) {
                            final method = _methods[index];
                            return _PaymentCard(
                              method: method,
                              onTap: () => _setDefault(method),
                              onDelete: () => _delete(method),
                            );
                          },
                        ),
                        const SizedBox(height: 28),
                        OutlinedButton.icon(
                          onPressed: _showAddDialog,
                          icon: const Icon(Icons.add_rounded),
                          label: const Text('Add New Payment Method'),
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

// ── Payment card ─────────────────────────────────────────────────────────────

class _PaymentCard extends StatelessWidget {
  const _PaymentCard({
    required this.method,
    required this.onTap,
    required this.onDelete,
  });

  final PaymentMethod method;
  final VoidCallback onTap;
  final VoidCallback onDelete;

  IconData _iconFor(String type) {
    switch (type.toUpperCase()) {
      case 'UPI':
        return Icons.account_balance_wallet_rounded;
      case 'CREDIT CARD':
        return Icons.credit_card_rounded;
      case 'DEBIT CARD':
        return Icons.credit_card_rounded;
      case 'NET BANKING':
        return Icons.account_balance_rounded;
      case 'WALLET':
        return Icons.wallet_rounded;
      default:
        return Icons.payment_rounded;
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDefault = method.isDefault;
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
              child: Icon(_iconFor(method.methodType),
                  color: TruxifyColors.accent, size: 22),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        method.methodType,
                        style:
                            Theme.of(context).textTheme.labelMedium?.copyWith(
                                  fontWeight: FontWeight.w600,
                                ),
                      ),
                      if (isDefault) ...[
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: TruxifyColors.accent.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            'Default',
                            style: Theme.of(context)
                                .textTheme
                                .labelSmall
                                ?.copyWith(
                                  color: TruxifyColors.accent,
                                  fontWeight: FontWeight.w600,
                                ),
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    method.displayLabel,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: TruxifyColors.adaptiveSecondaryText(context),
                        ),
                  ),
                  if (method.provider != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      method.provider!,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: TruxifyColors.adaptiveSecondaryText(context),
                            fontSize: 11,
                          ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 8),
            if (isDefault)
              const Icon(Icons.check_circle_rounded,
                  color: TruxifyColors.accent, size: 24)
            else
              IconButton(
                icon: const Icon(Icons.delete_outline_rounded, size: 20),
                color: Colors.red.shade400,
                onPressed: onDelete,
                tooltip: 'Remove',
              ),
          ],
        ),
      ),
    );
  }
}

// ── Add payment bottom sheet ──────────────────────────────────────────────────

class _AddPaymentSheet extends StatefulWidget {
  const _AddPaymentSheet();

  @override
  State<_AddPaymentSheet> createState() => _AddPaymentSheetState();
}

class _AddPaymentSheetState extends State<_AddPaymentSheet> {
  final _formKey = GlobalKey<FormState>();
  final _labelCtrl = TextEditingController();
  final _providerCtrl = TextEditingController();

  String _selectedType = 'UPI';
  bool _setAsDefault = false;
  bool _saving = false;

  static const _types = [
    'UPI',
    'Credit Card',
    'Debit Card',
    'Net Banking',
    'Wallet'
  ];

  @override
  void dispose() {
    _labelCtrl.dispose();
    _providerCtrl.dispose();
    super.dispose();
  }

  String _hintForType(String type) {
    switch (type) {
      case 'UPI':
        return 'e.g. name@okaxis';
      case 'Credit Card':
      case 'Debit Card':
        return 'e.g. **** **** **** 1234';
      case 'Net Banking':
        return 'e.g. HDFC Bank';
      case 'Wallet':
        return 'e.g. Paytm, PhonePe';
      default:
        return 'Display label';
    }
  }

  void _submit() {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);

    final method = PaymentMethod(
      id: '',
      userId: SupabaseService.requireUserId(),
      methodType: _selectedType,
      displayLabel: _labelCtrl.text.trim(),
      provider:
          _providerCtrl.text.trim().isEmpty ? null : _providerCtrl.text.trim(),
      isDefault: _setAsDefault,
    );

    Navigator.of(context).pop(method);
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
                Text(
                  'Add Payment Method',
                  style: Theme.of(context)
                      .textTheme
                      .titleMedium
                      ?.copyWith(fontWeight: FontWeight.w700),
                ),
                const Spacer(),
                IconButton(
                  icon: const Icon(Icons.close_rounded),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              initialValue: _selectedType,
              decoration: const InputDecoration(labelText: 'Payment Type'),
              items: _types
                  .map((t) => DropdownMenuItem(value: t, child: Text(t)))
                  .toList(),
              onChanged: (v) =>
                  setState(() => _selectedType = v ?? _selectedType),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _labelCtrl,
              decoration: InputDecoration(
                labelText: 'Display Label',
                hintText: _hintForType(_selectedType),
              ),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Required' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _providerCtrl,
              decoration: const InputDecoration(
                labelText: 'Provider (optional)',
                hintText: 'e.g. HDFC, Axis, Paytm',
              ),
            ),
            const SizedBox(height: 8),
            SwitchListTile.adaptive(
              value: _setAsDefault,
              onChanged: (v) => setState(() => _setAsDefault = v),
              title: const Text('Set as default payment method'),
              contentPadding: EdgeInsets.zero,
              activeThumbColor: TruxifyColors.accent,
            ),
            const SizedBox(height: 12),
            PrimaryButton(
              label: _saving ? 'Saving…' : 'Save Payment Method',
              onPressed: _saving ? null : _submit,
            ),
          ],
        ),
      ),
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
        Icon(Icons.credit_card_off_rounded,
            size: 64, color: TruxifyColors.adaptiveSecondaryText(context)),
        const SizedBox(height: 16),
        Text('No payment methods',
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        Text(
          'Add a payment method to get started.',
          style: Theme.of(context)
              .textTheme
              .bodyMedium
              ?.copyWith(color: TruxifyColors.adaptiveSecondaryText(context)),
        ),
        const SizedBox(height: 32),
        OutlinedButton.icon(
          onPressed: onAdd,
          icon: const Icon(Icons.add_rounded),
          label: const Text('Add New Payment Method'),
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
            const Icon(Icons.error_outline_rounded,
                size: 48, color: Colors.red),
            const SizedBox(height: 12),
            Text('Something went wrong',
                style: Theme.of(context).textTheme.titleMedium),
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
