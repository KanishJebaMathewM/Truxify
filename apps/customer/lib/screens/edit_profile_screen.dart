import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../l10n/app_localizations.dart';
import '../services/profile_service.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';

class EditProfileScreen extends StatefulWidget {
  const EditProfileScreen({super.key});

  @override
  State<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends State<EditProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _nameController;
  late final TextEditingController _companyController;
  late final TextEditingController _phoneController;
  final _profileService = ProfileService();
  bool _isLoading = true;
  bool _isSaving = false;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController();
    _companyController = TextEditingController();
    _phoneController = TextEditingController();
    _loadProfile();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _companyController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  Future<void> _loadProfile() async {
    try {
      final data = await _profileService.fetchProfile();
      final profile = data['profile'] as Map<String, dynamic>?;
      if (profile != null && mounted) {
        setState(() {
          _nameController.text = profile['fullName']?.toString() ?? '';
          _companyController.text = profile['companyName']?.toString() ?? '';
          _phoneController.text = profile['phone']?.toString() ?? '';
          _isLoading = false;
        });
      } else if (mounted) {
        setState(() => _isLoading = false);
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _loadError = e.toString();
        });
      }
    }
  }

  Future<void> _saveProfile() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isSaving = true);

    try {
      await _profileService.updateProfile(
        fullName: _nameController.text.trim(),
        companyName: _companyController.text.trim(),
        phone: _phoneController.text.trim(),
      );

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(AppLocalizations.of(context)!.profileUpdatedSuccessfully),
          backgroundColor: TruxifyColors.success,
        ),
      );
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(AppLocalizations.of(context)!.error(e.toString())),
          backgroundColor: TruxifyColors.errorRed,
        ),
      );
      setState(() => _isSaving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(AppLocalizations.of(context)!.editProfile),
        centerTitle: true,
        elevation: 0,
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _loadError != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(AppLocalizations.of(context)!.failedToLoadProfile,
                            style: Theme.of(context)
                                .textTheme
                                .bodyLarge
                                ?.copyWith(color: TruxifyColors.errorRed)),
                        const SizedBox(height: 12),
                        OutlinedButton(
                          onPressed: () {
                            setState(() {
                              _loadError = null;
                              _isLoading = true;
                            });
                            _loadProfile();
                          },
                          child: Text(AppLocalizations.of(context)!.retry),
                        ),
                      ],
                    ),
                  ),
                )
              : Form(
                  key: _formKey,
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Center(
                          child: Stack(
                            children: [
                              Container(
                                width: 100,
                                height: 100,
                                decoration: BoxDecoration(
                                  color: TruxifyColors.accentLight,
                                  shape: BoxShape.circle,
                                ),
                                alignment: Alignment.center,
                                child: Text(
                                  _nameController.text.isNotEmpty
                                      ? _nameController.text
                                          .split(' ')
                                          .map((w) => w.isNotEmpty
                                              ? w[0].toUpperCase()
                                              : '')
                                          .take(2)
                                          .join()
                                      : 'KM',
                                  style: const TextStyle(
                                    fontSize: 32,
                                    fontWeight: FontWeight.w600,
                                    color: TruxifyColors.accent,
                                  ),
                                ),
                              ),
                              Positioned(
                                bottom: 0,
                                right: 0,
                                child: Container(
                                  width: 36,
                                  height: 36,
                                  decoration: BoxDecoration(
                                    color: TruxifyColors.accent,
                                    shape: BoxShape.circle,
                                  ),
                                  child: const Icon(
                                      Icons.camera_alt_rounded,
                                      color: Colors.white,
                                      size: 18),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 28),
                        Text(
                          AppLocalizations.of(context)!.fullName,
                          style: Theme.of(context)
                              .textTheme
                              .labelMedium
                              ?.copyWith(
                                color: TruxifyColors.primaryText,
                                fontWeight: FontWeight.w600,
                              ),
                        ),
                        const SizedBox(height: 8),
                        TextFormField(
                          controller: _nameController,
                          validator: (v) =>
                              (v == null || v.trim().isEmpty)
                                  ? AppLocalizations.of(context)!.nameIsRequired
                                  : null,
                          decoration: InputDecoration(
                            hintText: AppLocalizations.of(context)!.enterFullName,
                            border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(8)),
                          ),
                        ),
                        const SizedBox(height: 18),
                        Text(
                          AppLocalizations.of(context)!.companyName,
                          style: Theme.of(context)
                              .textTheme
                              .labelMedium
                              ?.copyWith(
                                color: TruxifyColors.primaryText,
                                fontWeight: FontWeight.w600,
                              ),
                        ),
                        const SizedBox(height: 8),
                        TextFormField(
                          controller: _companyController,
                          validator: (v) =>
                              (v == null || v.trim().isEmpty)
                                  ? AppLocalizations.of(context)!.companyNameIsRequired
                                  : null,
                          decoration: InputDecoration(
                            hintText: AppLocalizations.of(context)!.enterCompanyName,
                            border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(8)),
                          ),
                        ),
                        const SizedBox(height: 18),
                        Text(
                          AppLocalizations.of(context)!.phoneNumber,
                          style: Theme.of(context)
                              .textTheme
                              .labelMedium
                              ?.copyWith(
                                color: TruxifyColors.primaryText,
                                fontWeight: FontWeight.w600,
                              ),
                        ),
                        const SizedBox(height: 8),
                        TextFormField(
                          controller: _phoneController,
                          keyboardType: TextInputType.phone,
                          validator: (v) =>
                              (v == null || v.trim().isEmpty)
                                  ? AppLocalizations.of(context)!.phoneNumberIsRequired
                                  : null,
                          decoration: InputDecoration(
                            hintText: AppLocalizations.of(context)!.enterPhoneNumber,
                            border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(8)),
                          ),
                        ),
                        const SizedBox(height: 32),
                        PrimaryButton(
                          label: _isSaving ? AppLocalizations.of(context)!.saving : AppLocalizations.of(context)!.saveChanges,
                          onPressed: _isSaving ? null : _saveProfile,
                        ),
                      ],
                    ),
                  ),
                ),
    );
  }
}
