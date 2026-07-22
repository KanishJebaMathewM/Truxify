import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:truxify_driver/services/api_client.dart';
import 'package:truxify_driver/services/driver_earnings_service.dart';
import '../../l10n/app_localizations.dart';
import '../../theme/app_theme.dart';

/// Shows the wallet withdrawal bottom sheet and returns `true` if the
/// withdrawal succeeded, `false` otherwise (user cancelled or error).
Future<bool> showWithdrawBottomSheet(
  BuildContext context, {
  required double confirmedBalanceRupees,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => WithdrawBottomSheet(
      confirmedBalanceRupees: confirmedBalanceRupees,
    ),
  ).then((result) => result ?? false);
}

class WithdrawBottomSheet extends StatefulWidget {
  const WithdrawBottomSheet({
    super.key,
    required this.confirmedBalanceRupees,
  });

  /// Current confirmed wallet balance in rupees.
  final double confirmedBalanceRupees;

  @override
  State<WithdrawBottomSheet> createState() => _WithdrawBottomSheetState();
}

class _WithdrawBottomSheetState extends State<WithdrawBottomSheet> {
  final _formKey = GlobalKey<FormState>();
  final _amountController = TextEditingController();
  final _amountFocusNode = FocusNode();
  bool _isSubmitting = false;
  String? _serverError;

  late final DriverEarningsService _earningsService;

  /// Confirmed balance converted to paisa (integer) for API communication.
  int get _confirmedBalancePaisa =>
      (widget.confirmedBalanceRupees * 100).round();

  /// User-entered amount in paisa, or null if invalid.
  int? get _amountPaisa {
    final text = _amountController.text.trim();
    if (text.isEmpty) return null;
    final rupees = double.tryParse(text);
    if (rupees == null || rupees <= 0) return null;
    return (rupees * 100).round();
  }

  bool get _isValidAmount {
    final amount = _amountPaisa;
    if (amount == null) return false;
    if (amount <= 0) return false;
    if (amount > _confirmedBalancePaisa) return false;
    return true;
  }

  @override
  void initState() {
    super.initState();
    _earningsService = DriverEarningsService();
  }

  @override
  void dispose() {
    _amountController.dispose();
    _amountFocusNode.dispose();
    _earningsService.dispose();
    super.dispose();
  }

  void _setQuickFill(double fraction) {
    final amountRupees = widget.confirmedBalanceRupees * fraction;
    final display =
        amountRupees == amountRupees.roundToDouble()
            ? amountRupees.toInt().toString()
            : amountRupees.toStringAsFixed(2);
    _amountController.text = display;
    _amountController.selection = TextSelection.fromPosition(
      TextPosition(offset: _amountController.text.length),
    );
    setState(() => _serverError = null);
  }

  Future<void> _submit() async {
    if (!_isValidAmount || _isSubmitting) return;

    // Dismiss keyboard
    _amountFocusNode.unfocus();

    setState(() {
      _isSubmitting = true;
      _serverError = null;
    });

    final amountPaisa = _amountPaisa!;

    try {
      await _earningsService.withdrawFunds(amountPaisa);
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _serverError = _humanizeApiError(e);
        _isSubmitting = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _serverError = e.toString().replaceFirst('Exception: ', '');
        _isSubmitting = false;
      });
    }
  }

  String _humanizeApiError(ApiException e) {
    if (e.statusCode == 400) {
      // Try to extract the "available" and "requested" from the body.
      return e.message.isNotEmpty ? e.message : 'Invalid withdrawal request.';
    }
    if (e.statusCode == 401) return 'Session expired. Please log in again.';
    if (e.statusCode == 404) return 'Driver profile not found.';
    if (e.statusCode >= 500) return 'Server error. Please try again later.';
    return e.message.isNotEmpty ? e.message : 'Withdrawal failed.';
  }

  String _formatRupees(double amount) {
    return '₹${amount.toStringAsFixed(0)}';
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Padding(
      padding: EdgeInsets.only(bottom: bottomInset),
      child: Container(
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surface,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
        ),
        child: SafeArea(
          top: false,
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 12, 24, 24),
            child: Form(
              key: _formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _buildHandle(),
                  const SizedBox(height: 16),
                  _buildHeader(l10n),
                  const SizedBox(height: 20),
                  _buildBalanceCard(l10n),
                  const SizedBox(height: 24),
                  _buildAmountField(l10n),
                  const SizedBox(height: 12),
                  _buildQuickFillChips(l10n),
                  if (_serverError != null) ...[
                    const SizedBox(height: 12),
                    _buildErrorBanner(),
                  ],
                  const SizedBox(height: 24),
                  _buildActionButtons(l10n),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildHandle() {
    return Center(
      child: Container(
        width: 40,
        height: 4,
        margin: const EdgeInsets.only(top: 4),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.outlineVariant,
          borderRadius: BorderRadius.circular(2),
        ),
      ),
    );
  }

  Widget _buildHeader(AppLocalizations l10n) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          l10n.withdrawFunds,
          style: GoogleFonts.dmSans(
            fontSize: 20,
            fontWeight: FontWeight.w700,
            color: Theme.of(context).colorScheme.onSurface,
          ),
        ),
        IconButton(
          onPressed: () => Navigator.of(context).pop(false),
          icon: Icon(
            Icons.close_rounded,
            color: TruxifyColors.adaptiveSecondaryText(context),
          ),
        ),
      ],
    );
  }

  Widget _buildBalanceCard(AppLocalizations l10n) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: TruxifyColors.successLight,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: TruxifyColors.success.withValues(alpha: 0.2),
        ),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: const BoxDecoration(
              color: TruxifyColors.success,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.account_balance_wallet_rounded,
              color: Colors.white,
              size: 20,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.availableBalance,
                  style: GoogleFonts.dmSans(
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                    color: TruxifyColors.success,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  _formatRupees(widget.confirmedBalanceRupees),
                  style: GoogleFonts.dmSans(
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    color: TruxifyColors.success,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAmountField(AppLocalizations l10n) {
    return TextFormField(
      controller: _amountController,
      focusNode: _amountFocusNode,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      inputFormatters: [
        FilteringTextInputFormatter.allow(RegExp(r'^\d*\.?\d{0,2}')),
      ],
      onChanged: (_) => setState(() {
        _serverError = null;
      }),
      style: GoogleFonts.dmSans(
        fontSize: 18,
        fontWeight: FontWeight.w700,
        color: Theme.of(context).colorScheme.onSurface,
      ),
      decoration: InputDecoration(
        labelText: l10n.enterAmount,
        labelStyle: GoogleFonts.dmSans(
          fontSize: 14,
          color: TruxifyColors.adaptiveSecondaryText(context),
        ),
        prefixIcon: Padding(
          padding: const EdgeInsets.only(left: 16, right: 8),
          child: Text(
            '₹',
            style: GoogleFonts.dmSans(
              fontSize: 18,
              fontWeight: FontWeight.w700,
              color: Theme.of(context).colorScheme.onSurface,
            ),
          ),
        ),
        prefixIconConstraints: const BoxConstraints(minWidth: 0, minHeight: 0),
        suffixIcon: _amountController.text.isNotEmpty
            ? IconButton(
                onPressed: () {
                  _amountController.clear();
                  setState(() {});
                },
                icon: Icon(
                  Icons.clear_rounded,
                  size: 20,
                  color: TruxifyColors.adaptiveSecondaryText(context),
                ),
              )
            : null,
        hintText: '0',
        hintStyle: GoogleFonts.dmSans(
          fontSize: 18,
          fontWeight: FontWeight.w700,
          color: Theme.of(context)
              .colorScheme
              .onSurface
              .withValues(alpha: 0.2),
        ),
      ),
      validator: (value) {
        if (value == null || value.trim().isEmpty) {
          return l10n.amountRequired;
        }
        final rupees = double.tryParse(value.trim());
        if (rupees == null) return l10n.enterValidAmount;
        if (rupees <= 0) return l10n.amountMustBePositive;
        if (rupees > widget.confirmedBalanceRupees) {
          return l10n.insufficientBalance;
        }
        return null;
      },
    );
  }

  Widget _buildQuickFillChips(AppLocalizations l10n) {
    final fractions = [
      (0.25, '25%'),
      (0.50, '50%'),
      (0.75, '75%'),
      (1.00, l10n.max),
    ];

    return Row(
      children: fractions.map((entry) {
        final (fraction, label) = entry;
        return Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 3),
            child: OutlinedButton(
              onPressed: _isSubmitting ? null : () => _setQuickFill(fraction),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 10),
                side: BorderSide(
                  color: Theme.of(context).colorScheme.outlineVariant,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
              ),
              child: Text(
                label,
                style: GoogleFonts.dmSans(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: Theme.of(context).colorScheme.onSurface,
                ),
              ),
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _buildErrorBanner() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: TruxifyColors.errorLight,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: TruxifyColors.error.withValues(alpha: 0.2),
        ),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.error_outline_rounded,
            color: TruxifyColors.error,
            size: 18,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              _serverError!,
              style: GoogleFonts.dmSans(
                fontSize: 13,
                fontWeight: FontWeight.w500,
                color: TruxifyColors.error,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildActionButtons(AppLocalizations l10n) {
    return Row(
      children: [
        Expanded(
          child: OutlinedButton(
            onPressed: _isSubmitting
                ? null
                : () => Navigator.of(context).pop(false),
            child: Text(l10n.cancel),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: ElevatedButton(
            onPressed: (_isValidAmount && !_isSubmitting) ? _submit : null,
            style: ElevatedButton.styleFrom(
              backgroundColor: _isValidAmount
                  ? TruxifyColors.accent
                  : Theme.of(context).colorScheme.outlineVariant,
              foregroundColor: _isValidAmount
                  ? Colors.white
                  : TruxifyColors.adaptiveSecondaryText(context),
              disabledBackgroundColor: Theme.of(context)
                  .colorScheme
                  .outlineVariant
                  .withValues(alpha: 0.5),
              disabledForegroundColor:
                  TruxifyColors.adaptiveSecondaryText(context)
                      .withValues(alpha: 0.5),
            ),
            child: _isSubmitting
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : Text(l10n.withdraw),
          ),
        ),
      ],
    );
  }
}
