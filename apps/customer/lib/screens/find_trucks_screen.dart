import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:latlong2/latlong.dart';

import '../controllers/app_controller.dart';
import '../models/app_models.dart';
import '../models/saved_address.dart';
import '../repositories/address_repository.dart';
import '../theme/app_theme.dart';
import '../widgets/app_page_route.dart';
import '../widgets/common_widgets.dart';
import 'location_picker_screen.dart';
import 'truck_results_screen.dart';
import 'package:truxify_shared/shimmer_widget.dart';
import '../services/order_service.dart';

class FindTrucksScreen extends StatefulWidget {
  const FindTrucksScreen({super.key, AddressRepository? addressRepository})
      : _addressRepository = addressRepository;

  final AddressRepository? _addressRepository;

  @override
  State<FindTrucksScreen> createState() => _FindTrucksScreenState();
}

class _FindTrucksScreenState extends State<FindTrucksScreen> {
  final _formKey = GlobalKey<FormState>();

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
  final Set<String> _requirements = <String>{
    'Temperature control',
    'Loading help needed'
  };

  String _filterTruckType = 'Any';
  double _filterMinCapacity = 0;
  double _filterMaxCapacity = 25;
  String _filterMaterialType = 'Any';
  bool _hasActiveFilters = false;
  LatLng? _pickupPoint;
  LatLng? _dropPoint;

  String? _weightErrorText;
  bool _isLoading = false;

  // Estimated price state
  bool _estimateLoading = false;
  String? _estimateError;
  int? _estimateMinPrice;
  int? _estimateMaxPrice;

  // Saved addresses state
  late final AddressRepository _addressRepo;
  List<SavedAddress> _savedAddresses = [];
  bool _addressesLoading = false;
  String? _addressesError;

  static const _goodsTypes = <String>[
    'Textile',
    'Electronics',
    'Food',
    'Machinery',
    'Furniture',
    'Other'
  ];
  static const _requirementsOptions = <String>[
    'Temperature control',
    'Waterproof cover',
    'Loading help needed'
  ];

  String _requirementDisplayLabel(String requirement) {
    if (requirement == 'Loading help needed') {
      return 'Loading help';
    }
    return requirement;
  }

  @override
  void initState() {
    super.initState();
    _addressRepo = widget._addressRepository ?? AddressRepository();
    _pickupController = TextEditingController();
    _dropController = TextEditingController();
    _weightController = TextEditingController();
    _lengthController = TextEditingController();
    _widthController = TextEditingController();
    _heightController = TextEditingController();
    _selectedDate = DateUtils.dateOnly(DateTime.now().add(const Duration(days: 1)));
    _selectedTime = const TimeOfDay(hour: 6, minute: 0);
    _dateController = TextEditingController(text: _formatDateLabel(_selectedDate!));
    _timeController = TextEditingController(text: _formatTimeLabel(_selectedTime!));
    _customGoodsTypeController = TextEditingController();
    _loadSavedAddresses();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final controller = TruxifyScope.of(context);
    final draft = controller.consumePendingRouteDraft();
    if (draft != null) {
      _pickupController.text = draft.pickup;
      _dropController.text = draft.drop;
      if (draft.pickupLat != null && draft.pickupLng != null) {
        _pickupPoint = LatLng(draft.pickupLat!, draft.pickupLng!);
      }
      if (draft.dropLat != null && draft.dropLng != null) {
        _dropPoint = LatLng(draft.dropLat!, draft.dropLng!);
      }
      _weightController.text = draft.weightTonnes;
      final parts = draft.dimensions.split(' × ');
      if (parts.length == 3) {
        _lengthController.text = parts[0];
        _widthController.text = parts[1];
        _heightController.text = parts[2];
      }
      final parsedDateTime = _parseDateTimeLabel(draft.dateLabel);
      _selectedDate = parsedDateTime?.date ??
          _selectedDate ??
          DateUtils.dateOnly(DateTime.now().add(const Duration(days: 1)));
      _selectedTime = parsedDateTime?.time ??
          _selectedTime ??
          const TimeOfDay(hour: 6, minute: 0);
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
    final initialDate = _selectedDate ??
        DateUtils.dateOnly(DateTime.now().add(const Duration(days: 1)));
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

    _formKey.currentState?.validate();
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
    DateTime? pickupDate;
    final parsed = _parseDateTimeLabel(_composeDateTimeLabel());
    if (parsed != null) {
      pickupDate = DateTime(
        parsed.date.year,
        parsed.date.month,
        parsed.date.day,
        parsed.time.hour,
        parsed.time.minute,
      );
    }
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
      pickupDate: pickupDate,
      pickupLat: _pickupPoint?.latitude,
      pickupLng: _pickupPoint?.longitude,
      dropLat: _dropPoint?.latitude,
      dropLng: _dropPoint?.longitude,
      truckType: _filterTruckType != 'Any' ? _filterTruckType : null,
      minCapacity: _filterMinCapacity > 0 ? _filterMinCapacity : null,
      maxCapacity: _filterMaxCapacity < 25 ? _filterMaxCapacity : null,
      materialType: _filterMaterialType != 'Any' ? _filterMaterialType : null,
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

  // ── Saved addresses ────────────────────────────────────────────────────

  Future<void> _loadSavedAddresses() async {
    setState(() {
      _addressesLoading = true;
      _addressesError = null;
    });
    try {
      final addresses = await _addressRepo.fetchAll();
      if (mounted) setState(() => _savedAddresses = addresses);
    } catch (e) {
      if (mounted) setState(() => _addressesError = e.toString());
    } finally {
      if (mounted) setState(() => _addressesLoading = false);
    }
  }

  void _applySavedAddress(SavedAddress address, {required bool isPickup}) {
    final fullAddr = address.fullAddress;
    setState(() {
      if (isPickup) {
        _pickupController.text = fullAddr;
        if (address.latitude != null && address.longitude != null) {
          _pickupPoint = LatLng(address.latitude!, address.longitude!);
        }
      } else {
        _dropController.text = fullAddr;
        if (address.latitude != null && address.longitude != null) {
          _dropPoint = LatLng(address.latitude!, address.longitude!);
        }
      }
    });
    _formKey.currentState?.validate();
    _estimatePrice();
  }

  void _showSavedAddressSheet({required bool isPickup}) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _AddressPickerSheet(
        addresses: _savedAddresses,
        isLoading: _addressesLoading,
        error: _addressesError,
        isPickup: isPickup,
        onRetry: _loadSavedAddresses,
        onSelect: (address) {
          Navigator.of(context).pop();
          _applySavedAddress(address, isPickup: isPickup);
        },
      ),
    );
  }

  IconData _iconForLabel(String label) {
    final l = label.toLowerCase();
    if (l.contains('home')) return Icons.home_rounded;
    if (l.contains('office') || l.contains('work')) return Icons.business_rounded;
    if (l.contains('warehouse')) return Icons.warehouse_rounded;
    return Icons.location_on_rounded;
  }

  Future<void> _promptSaveNewAddress(String address, LatLng point) async {
    final shouldSave = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Save this address?'),
        content: const Text('Would you like to save this location for future bookings?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Not now'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Save'),
          ),
        ],
      ),
    );

    if (shouldSave != true || !mounted) return;

    final label = await showDialog<String>(
      context: context,
      builder: (ctx) {
        final ctrl = TextEditingController();
        return AlertDialog(
          title: const Text('Label this address'),
          content: TextField(
            controller: ctrl,
            autofocus: true,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(
              hintText: 'e.g. Home, Office, Warehouse',
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(ctx, ctrl.text.trim()),
              child: const Text('Save'),
            ),
          ],
        );
      },
    );

    if (label == null || label.isEmpty || !mounted) return;

    try {
      final newAddress = SavedAddress(
        id: '',
        userId: '',
        label: label,
        addressLine: address,
        city: '',
        state: '',
        pincode: '',
        latitude: point.latitude,
        longitude: point.longitude,
        isDefault: _savedAddresses.isEmpty,
      );
      await _addressRepo.add(newAddress);
      await _loadSavedAddresses();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Address saved')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to save address'), backgroundColor: Colors.red),
        );
      }
    }
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

    if (!mounted) return;
    setState(() {
      if (isPickup) {
        _pickupController.text = result.address;
        _pickupPoint = result.point;
      } else {
        _dropController.text = result.address;
        _dropPoint = result.point;
      }
    });

    _formKey.currentState?.validate();
    _estimatePrice();

    if (mounted) {
      _promptSaveNewAddress(result.address, result.point);
    }
  }

  String? _validatePickup(String? value) {
    final text = value?.trim() ?? '';
    if (text.isEmpty) {
      return 'Please select a pickup location.';
    }
    if (text == _dropController.text.trim() && text.isNotEmpty) {
      return 'Pickup and drop locations cannot be the same.';
    }
    return null;
  }

  String? _validateDrop(String? value) {
    final text = value?.trim() ?? '';
    if (text.isEmpty) {
      return 'Please select a drop location.';
    }
    if (text == _pickupController.text.trim() && text.isNotEmpty) {
      return 'Pickup and drop locations cannot be the same.';
    }
    return null;
  }

  String? _validateDate(String? value) {
    if (_selectedDate == null || (value?.trim().isEmpty ?? true)) {
      return 'Please select a future pickup date.';
    }
    final today = DateUtils.dateOnly(DateTime.now());
    if (!_selectedDate!.isAfter(today.subtract(const Duration(days: 1)))) {
      if (_selectedDate!.isBefore(today)) {
        return 'Please select a future pickup date.';
      }
    }
    return null;
  }

  String? _validateWeight(String? value) {
    final text = value?.trim() ?? '';

    if (text.isEmpty) {
      return 'Weight must be greater than 0.';
    }
    final weight = double.tryParse(text);
    if (weight == null) {
      return 'Please enter a valid numeric weight.';
    }
    if (weight <= 0) {
      return 'Weight must be greater than 0.';
    }
    if (weight < 0.1 || weight > 50) {
      return 'Weight must be between 0.1 and 50 tonnes.';
    }
    return null;
  }

  void _onWeightChanged(String value) {
    setState(() => _weightErrorText = _validateWeight(value));
  }

  void _onFindTrucks() {
    if (_isLoading) return;
    
    if (!(_formKey.currentState?.validate() ?? false)) {
      return;
    }

    if (_pickupPoint == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a pickup location on the map.')),
      );
      return;
    }

    if (_dropPoint == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a drop location on the map.')),
      );
      return;
    }

    setState(() {
      _isLoading = true;
    });

    Navigator.of(context).push(
      AppPageRoute(builder: (_) => TruckResultsScreen(draft: _buildDraft())),
    ).then((_) {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    });
  }

  void _showFilterSheet() {
    final truckTypes = ['Any', 'Open Body', 'Closed Body', 'Container', 'Refrigerated'];
    final materialTypes = ['Any', 'Textile', 'Electronics', 'Food', 'Machinery', 'Furniture'];

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            return Padding(
              padding: EdgeInsets.fromLTRB(
                  20, 10, 20, MediaQuery.of(context).viewInsets.bottom + 20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(
                    child: Container(
                      width: 40,
                      height: 4,
                      margin: const EdgeInsets.only(bottom: 20),
                      decoration: BoxDecoration(
                        color: TruxifyColors.hintText,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
                  Text(
                    'Filter Trucks',
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 20),
                  Text('Truck Type',
                      style: Theme.of(context).textTheme.labelMedium),
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    value: _filterTruckType,
                    items: truckTypes
                        .map((t) => DropdownMenuItem(value: t, child: Text(t)))
                        .toList(),
                    onChanged: (v) => setSheetState(() => _filterTruckType = v ?? 'Any'),
                    decoration: InputDecoration(
                      border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(8)),
                      contentPadding:
                          const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text('Capacity (tonnes)',
                      style: Theme.of(context).textTheme.labelMedium),
                  const SizedBox(height: 8),
                  RangeSlider(
                    values: RangeValues(_filterMinCapacity, _filterMaxCapacity),
                    min: 0,
                    max: 25,
                    divisions: 25,
                    labels: RangeLabels(
                      '${_filterMinCapacity.toInt()}t',
                      '${_filterMaxCapacity.toInt()}t',
                    ),
                    onChanged: (v) => setSheetState(() {
                      _filterMinCapacity = v.start;
                      _filterMaxCapacity = v.end;
                    }),
                  ),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('${_filterMinCapacity.toInt()} tonnes',
                          style: Theme.of(context).textTheme.bodySmall),
                      Text('${_filterMaxCapacity.toInt()} tonnes',
                          style: Theme.of(context).textTheme.bodySmall),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Text('Material Type',
                      style: Theme.of(context).textTheme.labelMedium),
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    value: _filterMaterialType,
                    items: materialTypes
                        .map((m) => DropdownMenuItem(value: m, child: Text(m)))
                        .toList(),
                    onChanged: (v) => setSheetState(() => _filterMaterialType = v ?? 'Any'),
                    decoration: InputDecoration(
                      border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(8)),
                      contentPadding:
                          const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    ),
                  ),
                  const SizedBox(height: 24),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: () {
                            setSheetState(() {
                              _filterTruckType = 'Any';
                              _filterMinCapacity = 0;
                              _filterMaxCapacity = 25;
                              _filterMaterialType = 'Any';
                            });
                          },
                          child: const Text('Reset'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: ElevatedButton(
                          onPressed: () {
                            setState(() {
                              _hasActiveFilters =
                                  _filterTruckType != 'Any' ||
                                  _filterMaterialType != 'Any' ||
                                  _filterMinCapacity > 0 ||
                                  _filterMaxCapacity < 25;
                            });
                            Navigator.of(context).pop();
                          },
                          style: ElevatedButton.styleFrom(
                            backgroundColor: TruxifyColors.accent,
                            foregroundColor: Colors.white,
                          ),
                          child: const Text('Apply'),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  Future<void> _estimatePrice() async {
    // Check if we have required data for estimation
    if (_pickupPoint == null || _dropPoint == null) {
      setState(() {
        _estimateError = null;
        _estimateMinPrice = null;
        _estimateMaxPrice = null;
      });
      return;
    }

    final weight = double.tryParse(_weightController.text.trim());
    if (weight == null || weight <= 0) {
      setState(() {
        _estimateError = null;
        _estimateMinPrice = null;
        _estimateMaxPrice = null;
      });
      return;
    }

    setState(() {
      _estimateLoading = true;
      _estimateError = null;
    });

    try {
      final service = OrderService();
      final result = await service.estimatePriceRange(
        pickupLat: _pickupPoint!.latitude,
        pickupLng: _pickupPoint!.longitude,
        dropLat: _dropPoint!.latitude,
        dropLng: _dropPoint!.longitude,
        weightTonnes: weight,
        isFragile: _fragile,
        isStackable: _stacked,
      );

      if (!mounted) return;

      setState(() {
        _estimateLoading = false;
        if (result != null) {
          _estimateMinPrice = result['minPrice'] as int?;
          _estimateMaxPrice = result['maxPrice'] as int?;
          _estimateError = null;
        } else {
          _estimateError = 'Estimate unavailable';
          _estimateMinPrice = null;
          _estimateMaxPrice = null;
        }
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _estimateLoading = false;
          _estimateError = 'Estimate unavailable';
          _estimateMinPrice = null;
          _estimateMaxPrice = null;
        });
      }
    }
  }

  String _formatPrice(int paise) {
    return '₹${(paise / 100).round().toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',')}';
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Form(
        key: _formKey,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Find Trucks',
                        style: Theme.of(context)
                            .textTheme
                            .headlineSmall
                            ?.copyWith(fontWeight: FontWeight.w800),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'ML powered matching',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: TruxifyColors.adaptiveSecondaryText(context)),
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
                      onPressed: _showFilterSheet,
                      icon: Badge(
                        isLabelVisible: _hasActiveFilters,
                        child: const Icon(Icons.filter_list_rounded,
                            color: TruxifyColors.accentDark),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 24),

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
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    TextFormField(
                      controller: _pickupController,
                      readOnly: true,
                      onTap: () => _openLocationPicker(isPickup: true),
                      validator: _validatePickup,
                      decoration: InputDecoration(
                        labelText: 'Pickup Location',
                        prefixIcon: const Icon(Icons.location_on_rounded,
                            color: TruxifyColors.accentDark),
                        prefixIconConstraints: const BoxConstraints(minWidth: 40, minHeight: 40),
                        suffixIcon: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            IconButton(
                              onPressed: () => _showSavedAddressSheet(isPickup: true),
                              icon: const Icon(Icons.bookmark_rounded,
                                  color: TruxifyColors.accentDark),
                              tooltip: 'Saved addresses',
                            ),
                            IconButton(
                              onPressed: () => _openLocationPicker(isPickup: true),
                              icon: const Icon(Icons.map_rounded,
                                  color: TruxifyColors.accentDark),
                            ),
                          ],
                        ),
                      ),
                    ),
                    if (_savedAddresses.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      SizedBox(
                        height: 36,
                        child: ListView.separated(
                          scrollDirection: Axis.horizontal,
                          itemCount: _savedAddresses.length,
                          separatorBuilder: (_, __) => const SizedBox(width: 8),
                          itemBuilder: (context, index) {
                            final addr = _savedAddresses[index];
                            final selected = _pickupController.text == addr.fullAddress;
                            return Material(
                              color: Colors.transparent,
                              child: InkWell(
                                onTap: () => _applySavedAddress(addr, isPickup: true),
                                borderRadius: BorderRadius.circular(999),
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                  decoration: BoxDecoration(
                                    color: selected
                                        ? (Theme.of(context).brightness == Brightness.dark
                                            ? TruxifyColors.darkAccentLight
                                            : TruxifyColors.accentLight)
                                        : Theme.of(context).colorScheme.surfaceContainerHighest,
                                    borderRadius: BorderRadius.circular(999),
                                    border: Border.all(
                                      color: selected
                                          ? TruxifyColors.accent
                                          : (Theme.of(context).brightness == Brightness.dark
                                              ? TruxifyColors.darkBorder
                                              : TruxifyColors.border),
                                    ),
                                  ),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Icon(
                                        _iconForLabel(addr.label),
                                        size: 14,
                                        color: selected
                                            ? TruxifyColors.accentDark
                                            : TruxifyColors.adaptiveSecondaryText(context),
                                      ),
                                      const SizedBox(width: 6),
                                      Text(
                                        addr.label,
                                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
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
                          },
                        ),
                      ),
                    ],
                    const SizedBox(height: 12),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: TextFormField(
                            controller: _dropController,
                            readOnly: true,
                            onTap: () => _openLocationPicker(isPickup: false),
                            validator: _validateDrop,
                            decoration: InputDecoration(
                              labelText: 'Drop Location',
                              prefixIcon: const Icon(Icons.location_on_rounded,
                                  color: Color(0xFFD32F2F)),
                              prefixIconConstraints: const BoxConstraints(minWidth: 40, minHeight: 40),
                              suffixIcon: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  IconButton(
                                    onPressed: () => _showSavedAddressSheet(isPickup: false),
                                    icon: const Icon(Icons.bookmark_rounded,
                                        color: TruxifyColors.accentDark),
                                    tooltip: 'Saved addresses',
                                  ),
                                  IconButton(
                                    onPressed: () => _openLocationPicker(isPickup: false),
                                    icon: const Icon(Icons.map_rounded,
                                        color: TruxifyColors.accentDark),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Container(
                            width: 48,
                            height: 48,
                            decoration: BoxDecoration(
                              color: TruxifyColors.accentLight,
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: TruxifyColors.border),
                            ),
                            child: IconButton(
                              onPressed: _swapLocations,
                              icon: const Icon(Icons.swap_vert_rounded,
                                  color: TruxifyColors.accentDark),
                            ),
                          ),
                        ),
                      ],
                    ),
                    if (_savedAddresses.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      SizedBox(
                        height: 36,
                        child: ListView.separated(
                          scrollDirection: Axis.horizontal,
                          itemCount: _savedAddresses.length,
                          separatorBuilder: (_, __) => const SizedBox(width: 8),
                          itemBuilder: (context, index) {
                            final addr = _savedAddresses[index];
                            final selected = _dropController.text == addr.fullAddress;
                            return Material(
                              color: Colors.transparent,
                              child: InkWell(
                                onTap: () => _applySavedAddress(addr, isPickup: false),
                                borderRadius: BorderRadius.circular(999),
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                  decoration: BoxDecoration(
                                    color: selected
                                        ? (Theme.of(context).brightness == Brightness.dark
                                            ? TruxifyColors.darkAccentLight
                                            : TruxifyColors.accentLight)
                                        : Theme.of(context).colorScheme.surfaceContainerHighest,
                                    borderRadius: BorderRadius.circular(999),
                                    border: Border.all(
                                      color: selected
                                          ? TruxifyColors.accent
                                          : (Theme.of(context).brightness == Brightness.dark
                                              ? TruxifyColors.darkBorder
                                              : TruxifyColors.border),
                                    ),
                                  ),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Icon(
                                        _iconForLabel(addr.label),
                                        size: 14,
                                        color: selected
                                            ? TruxifyColors.accentDark
                                            : TruxifyColors.adaptiveSecondaryText(context),
                                      ),
                                      const SizedBox(width: 6),
                                      Text(
                                        addr.label,
                                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
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
                          },
                        ),
                      ),
                    ],
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: TextFormField(
                            controller: _dateController,
                            readOnly: true,
                            onTap: _pickDate,
                            validator: _validateDate,
                            decoration: InputDecoration(
                              labelText: 'Date',
                              prefixIcon: const Icon(Icons.calendar_today_rounded,
                                  color: TruxifyColors.accentDark),
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
                              prefixIcon: const Icon(Icons.access_time_rounded,
                                  color: TruxifyColors.accentDark),
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
                    DropdownButtonFormField<String>(
                      value: _goodsType,
                      items: _goodsTypes
                          .map((type) => DropdownMenuItem(value: type, child: Text(type)))
                          .toList(),
                      onChanged: (value) => setState(() => _goodsType = value ?? _goodsType),
                      decoration: const InputDecoration(labelText: 'Goods Type'),
                    ),
                    if (_goodsType == 'Other') ...[
                      const SizedBox(height: 12),
                      TextField(
                        controller: _customGoodsTypeController,
                        textCapitalization: TextCapitalization.sentences,
                        decoration: const InputDecoration(
                          labelText: 'Describe your goods',
                          hintText: 'e.g. Chemicals, Scrap metal…',
                          prefixIcon: Icon(Icons.edit_note_rounded,
                              color: TruxifyColors.accentDark),
                          prefixIconConstraints: BoxConstraints(minWidth: 40, minHeight: 40),
                        ),
                      ),
                    ],
                    const SizedBox(height: 12),

                    Row(
                      children: [
                        Expanded(
                          child: TextFormField(
                            controller: _weightController,
                            keyboardType: TextInputType.number,
                            validator: _validateWeight,
                            onChanged: _onWeightChanged,
                            decoration: const InputDecoration(
                              labelText: 'Weight (t)',
                              hintText: '3',
                              floatingLabelBehavior: FloatingLabelBehavior.always,
                              contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 14),
                              errorStyle: TextStyle(fontSize: 0, height: 0),
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
                    if (_weightErrorText != null) ...[
                      const SizedBox(height: 6),
                      Text(
                        _weightErrorText!,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                          fontSize: 12,
                          height: 1.2,
                        ),
                      ),
                    ],
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: _ColorToggleButton(
                            icon: Icons.layers_rounded,
                            label: 'Stackable',
                            isSelected: _stacked,
                            onPressed: () {
                              setState(() => _stacked = !_stacked);
                              _estimatePrice();
                            },
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: _ColorToggleButton(
                            icon: Icons.warning_rounded,
                            label: 'Fragile',
                            isSelected: _fragile,
                            onPressed: () {
                              setState(() => _fragile = !_fragile);
                              _estimatePrice();
                            },
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
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
                                  color: selected
                                      ? Colors.transparent
                                      : (Theme.of(context).brightness == Brightness.dark
                                          ? TruxifyColors.darkBorder
                                          : TruxifyColors.border),
                                ),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  if (selected)
                                    Icon(Icons.check_rounded,
                                        color: TruxifyColors.accentDark, size: 16)
                                  else
                                    Icon(Icons.add_rounded,
                                        color: TruxifyColors.adaptiveSecondaryText(context), size: 16),
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

              Stack(
                children: [
                  Container(
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.surface,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                          color: (Theme.of(context).brightness == Brightness.dark
                              ? TruxifyColors.darkBorder
                              : TruxifyColors.border)),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.05),
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
                            if (!_estimateLoading && _estimateError == null && _estimateMinPrice != null)
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
                        if (_estimateLoading)
                          Text(
                            'Estimating price...',
                            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                                  fontWeight: FontWeight.w800,
                                  color: Theme.of(context).brightness == Brightness.dark
                                      ? TruxifyColors.accent
                                      : TruxifyColors.accentDark,
                                ),
                          )
                        else if (_estimateError != null)
                          Text(
                            _estimateError!,
                            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                                  fontWeight: FontWeight.w800,
                                  color: Theme.of(context).brightness == Brightness.dark
                                      ? TruxifyColors.accent
                                      : TruxifyColors.accentDark,
                                ),
                          )
                        else if (_estimateMinPrice != null && _estimateMaxPrice != null)
                          Text(
                            '${_formatPrice(_estimateMinPrice!)} — ${_formatPrice(_estimateMaxPrice!)}',
                            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                                  fontWeight: FontWeight.w800,
                                  color: Theme.of(context).brightness == Brightness.dark
                                      ? TruxifyColors.accent
                                      : TruxifyColors.accentDark,
                                ),
                          )
                        else
                          Text(
                            'Enter route details to view estimate',
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
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: TruxifyColors.adaptiveSecondaryText(context)),
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

              PrimaryButton(
                label: _isLoading ? 'Finding Trucks...' : 'Find Trucks',
                onPressed: _isLoading ? null : _onFindTrucks,
              ),
            ],
          ),
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
              color: isSelected
                  ? TruxifyColors.accentDark
                  : (Theme.of(context).brightness == Brightness.dark
                      ? TruxifyColors.darkBorder
                      : TruxifyColors.border),
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                icon,
                color: isSelected
                    ? Colors.white
                    : TruxifyColors.adaptiveSecondaryText(context),
                size: 24,
              ),
              if (label != null) ...[
                const SizedBox(width: 8),
                Text(
                  label!,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                        color: isSelected
                            ? Colors.white
                            : TruxifyColors.adaptiveSecondaryText(context),
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

// ── Saved address picker bottom sheet ─────────────────────────────────────

class _AddressPickerSheet extends StatelessWidget {
  const _AddressPickerSheet({
    required this.addresses,
    required this.isLoading,
    required this.error,
    required this.isPickup,
    required this.onRetry,
    required this.onSelect,
  });

  final List<SavedAddress> addresses;
  final bool isLoading;
  final String? error;
  final bool isPickup;
  final VoidCallback onRetry;
  final ValueChanged<SavedAddress> onSelect;

  IconData _iconForLabel(String label) {
    final l = label.toLowerCase();
    if (l.contains('home')) return Icons.home_rounded;
    if (l.contains('office') || l.contains('work')) return Icons.business_rounded;
    if (l.contains('warehouse')) return Icons.warehouse_rounded;
    return Icons.location_on_rounded;
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
      ),
      padding: EdgeInsets.fromLTRB(
          20, 10, 20, MediaQuery.of(context).viewInsets.bottom + 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
            child: Container(
              width: 40,
              height: 4,
              margin: const EdgeInsets.only(bottom: 16),
              decoration: BoxDecoration(
                color: TruxifyColors.hintText,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          Row(
            children: [
              Icon(
                isPickup ? Icons.location_on_rounded : Icons.location_off_rounded,
                color: TruxifyColors.accentDark,
                size: 20,
              ),
              const SizedBox(width: 8),
              Text(
                isPickup ? 'Select Pickup Address' : 'Select Drop Address',
                style: Theme.of(context)
                    .textTheme
                    .titleMedium
                    ?.copyWith(fontWeight: FontWeight.bold),
              ),
              const Spacer(),
              IconButton(
                icon: const Icon(Icons.close_rounded),
                onPressed: () => Navigator.of(context).pop(),
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (isLoading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (error != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 24),
              child: Center(
                child: Column(
                  children: [
                    const Icon(Icons.error_outline_rounded,
                        size: 36, color: Colors.red),
                    const SizedBox(height: 8),
                    Text('Failed to load addresses',
                        style: Theme.of(context).textTheme.bodyMedium),
                    const SizedBox(height: 12),
                    OutlinedButton.icon(
                      onPressed: onRetry,
                      icon: const Icon(Icons.refresh_rounded, size: 18),
                      label: const Text('Retry'),
                    ),
                  ],
                ),
              ),
            )
          else if (addresses.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 24),
              child: Center(
                child: Column(
                  children: [
                    Icon(Icons.location_off_rounded,
                        size: 36,
                        color: TruxifyColors.adaptiveSecondaryText(context)),
                    const SizedBox(height: 8),
                    Text('No saved addresses',
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              color: TruxifyColors.adaptiveSecondaryText(context),
                            )),
                  ],
                ),
              ),
            )
          else
            ConstrainedBox(
              constraints: BoxConstraints(
                maxHeight: MediaQuery.of(context).size.height * 0.4,
              ),
              child: ListView.separated(
                shrinkWrap: true,
                itemCount: addresses.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (context, index) {
                  final addr = addresses[index];
                  return Material(
                    color: Colors.transparent,
                    child: InkWell(
                      onTap: () => onSelect(addr),
                      borderRadius: BorderRadius.circular(12),
                      child: Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: Theme.of(context).brightness == Brightness.dark
                                ? TruxifyColors.darkBorder
                                : TruxifyColors.border,
                          ),
                        ),
                        child: Row(
                          children: [
                            Container(
                              width: 40,
                              height: 40,
                              decoration: BoxDecoration(
                                color: TruxifyColors.accentLight,
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Icon(
                                _iconForLabel(addr.label),
                                color: TruxifyColors.accent,
                                size: 20,
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    addr.label,
                                    style: Theme.of(context)
                                        .textTheme
                                        .labelMedium
                                        ?.copyWith(fontWeight: FontWeight.w600),
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    addr.fullAddress,
                                    style: Theme.of(context)
                                        .textTheme
                                        .bodySmall
                                        ?.copyWith(
                                          color: TruxifyColors.adaptiveSecondaryText(context),
                                        ),
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: 8),
                            Icon(Icons.chevron_right_rounded,
                                color: TruxifyColors.adaptiveSecondaryText(context)),
                          ],
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}
