import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:latlong2/latlong.dart';

import '../controllers/app_controller.dart';
import '../data/mock_data.dart';
import '../models/app_models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_page_route.dart';
import '../widgets/common_widgets.dart';
import 'location_picker_screen.dart';
import 'truck_results_screen.dart';

class FindTrucksScreen extends StatefulWidget {
  const FindTrucksScreen({super.key});

  @override
  State<FindTrucksScreen> createState() => _FindTrucksScreenState();
}

class _FindTrucksScreenState extends State<FindTrucksScreen> {
  late final TextEditingController _pickupController;
  late final TextEditingController _dropController;
  late final TextEditingController _weightController;
  late final TextEditingController _lengthController;
  late final TextEditingController _widthController;
  late final TextEditingController _heightController;
  late final TextEditingController _dateController;
  late final TextEditingController _timeController;
  late final TextEditingController _customGoodsTypeController;
  DateTime? _selectedDate;
  TimeOfDay? _selectedTime;
  String _goodsType = 'Textile';
  bool _stacked = true;
  bool _fragile = false;
  final Set<String> _requirements = <String>{'Temperature control', 'Loading help needed'};
  LatLng? _pickupPoint;
  LatLng? _dropPoint;

  static const _goodsTypes = <String>['Textile', 'Electronics', 'Food', 'Machinery', 'Furniture', 'Other'];
  static const _requirementsOptions = <String>['Temperature control', 'Waterproof cover', 'Loading help needed'];

  String _requirementDisplayLabel(String requirement) {
    if (requirement == 'Loading help needed') {
      return 'Loading help';
    }
    return requirement;
  }

  @override
  void initState() {
    super.initState();
    _setupFromDraft(mockDefaultRouteDraft);
  }

  void _setupFromDraft(RouteDraft draft) {
    _pickupController = TextEditingController(text: draft.pickup);
    _dropController = TextEditingController(text: draft.drop);
    _weightController = TextEditingController(text: draft.weightTonnes);
    _lengthController = TextEditingController(text: draft.dimensions.split(' × ').first);
    _widthController = TextEditingController(text: draft.dimensions.split(' × ')[1]);
    _heightController = TextEditingController(text: draft.dimensions.split(' × ')[2]);
    final parsedDateTime = _parseDateTimeLabel(draft.dateLabel);
    _selectedDate = parsedDateTime?.date ?? DateUtils.dateOnly(DateTime.now().add(const Duration(days: 1)));
    _selectedTime = parsedDateTime?.time ?? const TimeOfDay(hour: 6, minute: 0);
    _dateController = TextEditingController(text: _formatDateLabel(_selectedDate!));
    _timeController = TextEditingController(text: _formatTimeLabel(_selectedTime!));
    _goodsType = draft.goodsType;
    _customGoodsTypeController = TextEditingController();
    _stacked = draft.stacked;
    _fragile = draft.fragile;
    _requirements
      ..clear()
      ..addAll(draft.requirements);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final controller = TruxifyScope.of(context);
    final draft = controller.consumePendingRouteDraft();
    if (draft != null) {
      _pickupController.text = draft.pickup;
      _dropController.text = draft.drop;
      _weightController.text = draft.weightTonnes;
      final parts = draft.dimensions.split(' × ');
      if (parts.length == 3) {
        _lengthController.text = parts[0];
        _widthController.text = parts[1];
        _heightController.text = parts[2];
      }
      final parsedDateTime = _parseDateTimeLabel(draft.dateLabel);
      _selectedDate = parsedDateTime?.date ?? _selectedDate ?? DateUtils.dateOnly(DateTime.now().add(const Duration(days: 1)));
      _selectedTime = parsedDateTime?.time ?? _selectedTime ?? const TimeOfDay(hour: 6, minute: 0);
      _dateController.text = _formatDateLabel(_selectedDate!);
      _timeController.text = _formatTimeLabel(_selectedTime!);
      _goodsType = draft.goodsType;
      _stacked = draft.stacked;
      _fragile = draft.fragile;
      _requirements
        ..clear()
        ..addAll(draft.requirements);
      setState(() {});
    }
  }

  @override
  void dispose() {
    _pickupController.dispose();
    _dropController.dispose();
    _weightController.dispose();
    _lengthController.dispose();
    _widthController.dispose();
    _heightController.dispose();
    _dateController.dispose();
    _timeController.dispose();
      _customGoodsTypeController.dispose();
    super.dispose();
  }

  String _formatDateLabel(DateTime date) {
    final today = DateUtils.dateOnly(DateTime.now());
    final tomorrow = today.add(const Duration(days: 1));
    final normalized = DateUtils.dateOnly(date);

    if (normalized == today) {
      return 'Today';
    }
    if (normalized == tomorrow) {
      return 'Tomorrow';
    }
    return DateFormat('dd MMM yyyy').format(normalized);
  }

  String _formatTimeLabel(TimeOfDay time) {
    final now = DateTime.now();
    final dateTime = DateTime(now.year, now.month, now.day, time.hour, time.minute);
    return DateFormat('h:mm a').format(dateTime);
  }

  String _composeDateTimeLabel() {
    if (_selectedDate == null || _selectedTime == null) {
      return _dateController.text;
    }
    return '${_formatDateLabel(_selectedDate!)}, ${_formatTimeLabel(_selectedTime!)}';
  }

  _ParsedDateTime? _parseDateTimeLabel(String value) {
    final raw = value.trim();
    if (raw.isEmpty) {
      return null;
    }

    final parts = raw.split(',');
    if (parts.length < 2) {
      return null;
    }

    final datePart = parts.first.trim().toLowerCase();
    final timePart = parts.sublist(1).join(',').trim();
    if (timePart.isEmpty) {
      return null;
    }

    DateTime date;
    final today = DateUtils.dateOnly(DateTime.now());
    if (datePart == 'today') {
      date = today;
    } else if (datePart == 'tomorrow') {
      date = today.add(const Duration(days: 1));
    } else {
      try {
        date = DateFormat('dd MMM yyyy').parseStrict(parts.first.trim());
      } catch (_) {
        return null;
      }
    }

    DateTime parsedTime;
    try {
      parsedTime = DateFormat('h:mm a').parseStrict(timePart.toUpperCase());
    } catch (_) {
      return null;
    }

    return _ParsedDateTime(
      date: date,
      time: TimeOfDay(hour: parsedTime.hour, minute: parsedTime.minute),
    );
  }

  Future<void> _pickDate() async {
    final initialDate = _selectedDate ?? DateUtils.dateOnly(DateTime.now().add(const Duration(days: 1)));
    final firstDate = DateUtils.dateOnly(DateTime.now());
    final lastDate = firstDate.add(const Duration(days: 365));

    final pickedDate = await showDatePicker(
      context: context,
      initialDate: initialDate,
      firstDate: firstDate,
      lastDate: lastDate,
    );

    if (pickedDate == null) {
      return;
    }

    setState(() {
      _selectedDate = DateUtils.dateOnly(pickedDate);
      _dateController.text = _formatDateLabel(_selectedDate!);
    });
  }

  Future<void> _pickTime() async {
    final initialTime = _selectedTime ?? const TimeOfDay(hour: 6, minute: 0);
    final pickedTime = await showTimePicker(
      context: context,
      initialTime: initialTime,
    );

    if (pickedTime == null) {
      return;
    }

    setState(() {
      _selectedTime = pickedTime;
      _timeController.text = _formatTimeLabel(pickedTime);
    });
  }

  RouteDraft _buildDraft() {
    return RouteDraft(
      pickup: _pickupController.text,
      drop: _dropController.text,
      dateLabel: _composeDateTimeLabel(),
      goodsType: _goodsType,
      weightTonnes: _weightController.text,
      dimensions: '${_lengthController.text} × ${_widthController.text} × ${_heightController.text}',
      stacked: _stacked,
      fragile: _fragile,
      requirements: _requirements.toList(),
      pickupLat: _pickupPoint?.latitude,
      pickupLng: _pickupPoint?.longitude,
      dropLat: _dropPoint?.latitude,
      dropLng: _dropPoint?.longitude,
    );
  }

  void _swapLocations() {
    final pickup = _pickupController.text;
    final pickupPoint = _pickupPoint;
    _pickupController.text = _dropController.text;
    _pickupPoint = _dropPoint;
    _dropController.text = pickup;
    _dropPoint = pickupPoint;
    setState(() {});
  }

  Future<void> _openLocationPicker({required bool isPickup}) async {
    final result = await Navigator.of(context).push<LocationPickResult>(
      AppPageRoute(
        builder: (_) => LocationPickerScreen(
          title: isPickup ? 'Set Pickup Location' : 'Set Drop Location',
          initialQuery: isPickup ? _pickupController.text : _dropController.text,
          initialPoint: isPickup ? _pickupPoint : _dropPoint,
        ),
      ),
    );

    if (result == null) {
      return;
    }

    setState(() {
      if (isPickup) {
        _pickupController.text = result.address;
        _pickupPoint = result.point;
      } else {
        _dropController.text = result.address;
        _dropPoint = result.point;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header with Filter
            Row(
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Find Trucks',
                      style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'ML powered matching',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(color: TruxifyColors.adaptiveSecondaryText(context)),
                    ),
                  ],
                ),
                const Spacer(),
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: TruxifyColors.accentLight,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: IconButton(
                    onPressed: () {},
                    icon: const Icon(Icons.filter_list_rounded, color: TruxifyColors.accentDark),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),

            // ROUTE Section
            Text(
              'ROUTE',
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                    color: TruxifyColors.adaptiveSecondaryText(context),
                    letterSpacing: 0.5,
                  ),
            ),
            const SizedBox(height: 12),
            InfoCard(
              child: Column(
                children: [
                  // Pickup Location
                  TextField(
                    controller: _pickupController,
                    readOnly: true,
                    onTap: () => _openLocationPicker(isPickup: true),
                    decoration: InputDecoration(
                      labelText: 'Pickup Location',
                      prefixIcon: const Icon(Icons.location_on_rounded, color: TruxifyColors.accentDark),
                      prefixIconConstraints: const BoxConstraints(minWidth: 40, minHeight: 40),
                      suffixIcon: IconButton(
                        onPressed: () => _openLocationPicker(isPickup: true),
                        icon: const Icon(Icons.map_rounded, color: TruxifyColors.accentDark),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  // Drop Location + Swap
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _dropController,
                          readOnly: true,
                          onTap: () => _openLocationPicker(isPickup: false),
                          decoration: InputDecoration(
                            labelText: 'Drop Location',
                            prefixIcon: const Icon(Icons.location_on_rounded, color: Color(0xFFD32F2F)),
                            prefixIconConstraints: const BoxConstraints(minWidth: 40, minHeight: 40),
                            suffixIcon: IconButton(
                              onPressed: () => _openLocationPicker(isPickup: false),
                              icon: const Icon(Icons.map_rounded, color: TruxifyColors.accentDark),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Container(
                        width: 48,
                        height: 48,
                        decoration: BoxDecoration(
                          color: TruxifyColors.accentLight,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: TruxifyColors.border),
                        ),
                        child: IconButton(
                          onPressed: _swapLocations,
                          icon: const Icon(Icons.swap_vert_rounded, color: TruxifyColors.accentDark),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  // Date and Time
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _dateController,
                          readOnly: true,
                          onTap: _pickDate,
                          decoration: InputDecoration(
                            labelText: 'Date',
                            prefixIcon: const Icon(Icons.calendar_today_rounded, color: TruxifyColors.accentDark),
                            prefixIconConstraints: const BoxConstraints(minWidth: 40, minHeight: 40),
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          controller: _timeController,
                          readOnly: true,
                          onTap: _pickTime,
                          decoration: InputDecoration(
                            labelText: 'Time',
                            prefixIcon: const Icon(Icons.access_time_rounded, color: TruxifyColors.accentDark),
                            prefixIconConstraints: const BoxConstraints(minWidth: 40, minHeight: 40),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            // GOODS DETAILS Section
            Text(
              'GOODS DETAILS',
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                    color: TruxifyColors.adaptiveSecondaryText(context),
                    letterSpacing: 0.5,
                  ),
            ),
            const SizedBox(height: 12),
            InfoCard(
              child: Column(
                children: [
                  // Goods Type Dropdown
                  DropdownButtonFormField<String>(
                    initialValue: _goodsType,
                    items: _goodsTypes.map((type) => DropdownMenuItem(value: type, child: Text(type))).toList(),
                    onChanged: (value) => setState(() => _goodsType = value ?? _goodsType),
                    decoration: const InputDecoration(labelText: 'Goods Type'),
                  ),
                  // "Other" custom goods type text field
                  if (_goodsType == 'Other') ...[
                    const SizedBox(height: 12),
                    TextField(
                      controller: _customGoodsTypeController,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: const InputDecoration(
                        labelText: 'Describe your goods',
                        hintText: 'e.g. Chemicals, Scrap metal…',
                        prefixIcon: Icon(Icons.edit_note_rounded, color: TruxifyColors.accentDark),
                        prefixIconConstraints: BoxConstraints(minWidth: 40, minHeight: 40),
                      ),
                    ),
                  ],
                  const SizedBox(height: 12),
                  // Weight and Dimensions (4 columns) — labels use floating style so they never clip
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _weightController,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            labelText: 'Weight (t)',
                            hintText: '3',
                            floatingLabelBehavior: FloatingLabelBehavior.always,
                            contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 14),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: TextField(
                          controller: _lengthController,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            labelText: 'Length (ft)',
                            hintText: '12',
                            floatingLabelBehavior: FloatingLabelBehavior.always,
                            contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 14),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: TextField(
                          controller: _widthController,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            labelText: 'Width (ft)',
                            hintText: '6',
                            floatingLabelBehavior: FloatingLabelBehavior.always,
                            contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 14),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: TextField(
                          controller: _heightController,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            labelText: 'Height (ft)',
                            hintText: '6',
                            floatingLabelBehavior: FloatingLabelBehavior.always,
                            contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 14),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  // Stackable and Fragile toggles as colored buttons
                  Row(
                    children: [
                      Expanded(
                        child: _ColorToggleButton(
                          icon: Icons.layers_rounded,
                          label: 'Stackable',
                          isSelected: _stacked,
                          onPressed: () => setState(() => _stacked = !_stacked),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: _ColorToggleButton(
                          icon: Icons.warning_rounded,
                          label: 'Fragile',
                          isSelected: _fragile,
                          onPressed: () => setState(() => _fragile = !_fragile),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  // Special requirements
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      'Special requirements',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            fontWeight: FontWeight.w600,
                            color: TruxifyColors.adaptiveSecondaryText(context),
                          ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 10,
                    runSpacing: 10,
                    children: _requirementsOptions.map((item) {
                      final selected = _requirements.contains(item);
                      final label = _requirementDisplayLabel(item);

                      return Material(
                        color: Colors.transparent,
                        child: InkWell(
                          onTap: () {
                            setState(() {
                              if (selected) {
                                _requirements.remove(item);
                              } else {
                                _requirements.add(item);
                              }
                            });
                          },
                          borderRadius: BorderRadius.circular(999),
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                            decoration: BoxDecoration(
                              color: selected
                                  ? (Theme.of(context).brightness == Brightness.dark
                                      ? TruxifyColors.darkAccentLight
                                      : TruxifyColors.accentLight)
                                  : Theme.of(context).colorScheme.surfaceContainerHighest,
                              borderRadius: BorderRadius.circular(999),
                              border: Border.all(
                                color: selected ? Colors.transparent : (Theme.of(context).brightness == Brightness.dark ? TruxifyColors.darkBorder : TruxifyColors.border),
                              ),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                if (selected)
                                  Icon(Icons.check_rounded, color: TruxifyColors.accentDark, size: 16)
                                else
                                  Icon(Icons.add_rounded, color: TruxifyColors.adaptiveSecondaryText(context), size: 16),
                                const SizedBox(width: 6),
                                Text(
                                  label,
                                  style: Theme.of(context).textTheme.labelMedium?.copyWith(
                                        fontWeight: FontWeight.w600,
                                        color: selected
                                            ? TruxifyColors.accentDark
                                            : TruxifyColors.adaptiveSecondaryText(context),
                                      ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            // Estimated Price Range with Left Border
            Stack(
              children: [
                Container(
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.surface,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: (Theme.of(context).brightness == Brightness.dark ? TruxifyColors.darkBorder : TruxifyColors.border)),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withOpacity(0.05),
                        blurRadius: 8,
                        offset: const Offset(0, 2),
                      ),
                    ],
                  ),
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            'Estimated Price Range',
                            style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: TruxifyColors.accentLight,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Text(
                              'Stable this week',
                              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                                    color: TruxifyColors.accentDark,
                                    fontWeight: FontWeight.w600,
                                  ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(
                        '₹6,200 — ₹7,800',
                        style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                              fontWeight: FontWeight.w800,
                              color: Theme.of(context).brightness == Brightness.dark
                                  ? TruxifyColors.accent
                                  : TruxifyColors.accentDark,
                            ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Based on current demand + route',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(color: TruxifyColors.adaptiveSecondaryText(context)),
                      ),
                    ],
                  ),
                ),
                Positioned(
                  left: 0,
                  top: 0,
                  bottom: 0,
                  child: Container(
                    width: 4,
                    decoration: BoxDecoration(
                      color: TruxifyColors.accentDark,
                      borderRadius: const BorderRadius.only(
                        topLeft: Radius.circular(16),
                        bottomLeft: Radius.circular(16),
                      ),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),

            // Find Trucks Button
            PrimaryButton(
              label: 'Find Trucks',
              onPressed: () {
                Navigator.of(context).push(
                  AppPageRoute(builder: (_) => TruckResultsScreen(draft: _buildDraft())),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _ParsedDateTime {
  const _ParsedDateTime({required this.date, required this.time});

  final DateTime date;
  final TimeOfDay time;
}

class _ColorToggleButton extends StatelessWidget {
  const _ColorToggleButton({
    required this.icon,
    required this.isSelected,
    required this.onPressed,
    this.label,
  });

  final IconData icon;
  final bool isSelected;
  final VoidCallback onPressed;
  final String? label;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          height: 56,
          decoration: BoxDecoration(
            color: isSelected
                ? TruxifyColors.accentDark
                : Theme.of(context).colorScheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: isSelected ? TruxifyColors.accentDark : (Theme.of(context).brightness == Brightness.dark ? TruxifyColors.darkBorder : TruxifyColors.border),
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                icon,
                color: isSelected ? Colors.white : TruxifyColors.adaptiveSecondaryText(context),
                size: 24,
              ),
              if (label != null) ...[
                const SizedBox(width: 8),
                Text(
                  label!,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                        color: isSelected ? Colors.white : TruxifyColors.adaptiveSecondaryText(context),
                      ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
