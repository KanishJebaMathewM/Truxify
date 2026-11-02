// apps/customer/lib/screens/post_load_screen.dart
import 'package:flutter/material.dart';
import 'package:apps_customer/services/load_service.dart';

class PostLoadScreen extends StatefulWidget {
  const PostLoadScreen({super.key});

  @override
  State<PostLoadScreen> createState() => _PostLoadScreenState();
}

class _PostLoadScreenState extends State<PostLoadScreen> {
  final _formKey = GlobalKey<FormState>();
  final _loadService = LoadService();

  String _origin = '';
  String _destination = '';
  double _weightTons = 1.0;
  String _freightType = 'General';
  DateTime _pickupDate = DateTime.now().add(const Duration(days: 1));
  bool _isLoading = false;

  Future<void> _selectPickupDate(BuildContext context) async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _pickupDate,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (picked != null && picked != _pickupDate) {
      setState(() {
        _pickupDate = picked;
      });
    }
  }

  Future<void> _submitLoad() async {
    if (!_formKey.currentState!.validate()) return;
    _formKey.currentState!.save();

    setState(() => _isLoading = true);

    try {
      final success = await _loadService.postLoad({
        'origin': _origin.trim(),
        'destination': _destination.trim(),
        'weightTons': _weightTons,
        'freightType': _freightType,
        'pickupDate': _pickupDate.toIso8601String(),
      });

      if (!mounted) return;

      if (success) {
        Navigator.pop(context, true);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Load posted successfully!')),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to post load. Please try again.')),
        );
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error: ${e.toString()}')),
      );
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Post a Load'),
        elevation: 2,
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16.0),
          children: [
            TextFormField(
              decoration: const InputDecoration(
                labelText: 'Pickup Location (Origin)',
                prefixIcon: Icon(Icons.location_on_outlined),
                border: OutlineInputBorder(),
              ),
              validator: (v) => v == null || v.isEmpty ? 'Please enter origin location' : null,
              onSaved: (v) => _origin = v!,
            ),
            const SizedBox(height: 16),
            TextFormField(
              decoration: const InputDecoration(
                labelText: 'Delivery Location (Destination)',
                prefixIcon: Icon(Icons.flag_outlined),
                border: OutlineInputBorder(),
              ),
              validator: (v) => v == null || v.isEmpty ? 'Please enter destination location' : null,
              onSaved: (v) => _destination = v!,
            ),
            const SizedBox(height: 16),
            TextFormField(
              decoration: const InputDecoration(
                labelText: 'Weight (Tons)',
                prefixIcon: Icon(Icons.fitness_center),
                border: OutlineInputBorder(),
              ),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              validator: (v) {
                if (v == null || v.isEmpty) return 'Please enter load weight';
                final n = double.tryParse(v);
                if (n == null || n <= 0) return 'Enter a valid weight greater than 0';
                return null;
              },
              onSaved: (v) => _weightTons = double.parse(v!),
            ),
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              value: _freightType,
              decoration: const InputDecoration(
                labelText: 'Freight Type',
                prefixIcon: Icon(Icons.category_outlined),
                border: OutlineInputBorder(),
              ),
              items: const [
                DropdownMenuItem(value: 'General', child: Text('General')),
                DropdownMenuItem(value: 'Perishable', child: Text('Perishable')),
                DropdownMenuItem(value: 'Hazardous', child: Text('Hazardous')),
                DropdownMenuItem(value: 'Oversized', child: Text('Oversized')),
              ],
              onChanged: (v) => setState(() => _freightType = v!),
            ),
            const SizedBox(height: 16),
            InputDecorator(
              decoration: const InputDecoration(
                labelText: 'Pickup Date',
                prefixIcon: Icon(Icons.calendar_today),
                border: OutlineInputBorder(),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('${_pickupDate.toLocal()}'.split(' ')[0]),
                  TextButton(
                    onPressed: () => _selectPickupDate(context),
                    child: const Text('Change Date'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 32),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 16),
                textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
              ),
              onPressed: _isLoading ? null : _submitLoad,
              child: _isLoading
                  ? const CircularProgressIndicator(color: Colors.white)
                  : const Text('Post Load'),
            ),
          ],
        ),
      ),
    );
  }
}
