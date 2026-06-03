import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../models/faq.dart';
import '../repositories/faq_repository.dart';
import '../repositories/support_repository.dart';

class HelpCenterScreen extends StatefulWidget {
  const HelpCenterScreen({
    super.key,
    required this.appType,
    required this.faqRepository,
    required this.supportRepository,
    this.userId,
    this.title = 'Help Center',
  });

  final String appType;
  final String? userId;
  final String title;
  final FaqRepository faqRepository;
  final SupportRepository supportRepository;

  @override
  State<HelpCenterScreen> createState() => _HelpCenterScreenState();
}

class _HelpCenterScreenState extends State<HelpCenterScreen> {
  final _subjectController = TextEditingController();
  final _descriptionController = TextEditingController();
  String _category = 'General';
  bool _loadingFaqs = true;
  bool _submitting = false;
  String? _error;
  List<Faq> _faqs = [];

  @override
  void initState() {
    super.initState();
    _loadFaqs();
  }

  Future<void> _loadFaqs() async {
    try {
      final faqs = await widget.faqRepository.fetchFaqs(widget.appType);
      if (!mounted) return;
      setState(() => _faqs = faqs);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loadingFaqs = false);
    }
  }

  Future<void> _submit() async {
    if (_subjectController.text.trim().isEmpty || _descriptionController.text.trim().isEmpty) return;
    setState(() => _submitting = true);
    try {
      await widget.supportRepository.createSupportTicket(
        userId: widget.userId,
        subject: _subjectController.text.trim(),
        description: _descriptionController.text.trim(),
        category: _category,
      );
      _subjectController.clear();
      _descriptionController.clear();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Support ticket submitted successfully')));
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to submit support ticket')));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title), centerTitle: true),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('Frequently Asked Questions', style: GoogleFonts.dmSans(fontSize: 18, fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          if (_loadingFaqs) const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator()))
          else if (_error != null)
            _StateMessage(title: 'Could not load FAQs', message: _error!, icon: Icons.error_outline_rounded)
          else if (_faqs.isEmpty)
            const _StateMessage(title: 'No FAQs available', message: 'Please check back later.', icon: Icons.help_outline_rounded)
          else
            ..._faqs.map((faq) => Card(child: ExpansionTile(title: Text(faq.question), children: [Padding(padding: const EdgeInsets.all(16), child: Text(faq.answer))]))),
          const SizedBox(height: 24),
          Text('Contact Support', style: GoogleFonts.dmSans(fontSize: 18, fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          TextField(controller: _subjectController, decoration: const InputDecoration(labelText: 'Subject')),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            value: _category,
            items: const ['General', 'Booking', 'Billing', 'Technical'].map((value) => DropdownMenuItem(value: value, child: Text(value))).toList(),
            onChanged: (value) => setState(() => _category = value ?? 'General'),
            decoration: const InputDecoration(labelText: 'Category'),
          ),
          const SizedBox(height: 12),
          TextField(controller: _descriptionController, minLines: 4, maxLines: 6, decoration: const InputDecoration(labelText: 'Description')),
          const SizedBox(height: 16),
          ElevatedButton(onPressed: _submitting ? null : _submit, child: _submitting ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Submit')),
        ],
      ),
    );
  }
}

class _StateMessage extends StatelessWidget {
  const _StateMessage({required this.title, required this.message, required this.icon});

  final String title;
  final String message;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Column(
        children: [
          Icon(icon, size: 40),
          const SizedBox(height: 8),
          Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text(message, textAlign: TextAlign.center),
        ],
      ),
    );
  }
}

