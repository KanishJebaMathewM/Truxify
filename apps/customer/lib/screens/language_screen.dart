import 'package:flutter/material.dart';

import '../core/offline/cache/cache_manager.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';

class LanguageScreen extends StatefulWidget {
  const LanguageScreen({super.key});

  @override
  State<LanguageScreen> createState() => _LanguageScreenState();
}

class _LanguageScreenState extends State<LanguageScreen> {
  final CacheManager _cacheManager = CacheManager();
  int _selectedLanguageIndex = 0;

  final List<Map<String, String>> _languages = [
    {'code': 'en', 'name': 'English', 'native': 'English'},
    {'code': 'hi', 'name': 'Hindi', 'native': 'हिंदी'},
    {'code': 'gu', 'name': 'Gujarati', 'native': 'ગુજરાતી'},
    {'code': 'mr', 'name': 'Marathi', 'native': 'मराठी'},
    {'code': 'ta', 'name': 'Tamil', 'native': 'தமிழ்'},
    {'code': 'te', 'name': 'Telugu', 'native': 'తెలుగు'},
  ];

  void _showLanguageChangedSnackBar() {
    final languageName = _languages[_selectedLanguageIndex]['name'] ?? '';
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Language changed to $languageName')),
    );
  }

  @override
  void initState() {
    super.initState();
    _restoreLanguage();
  }

  Future<void> _restoreLanguage() async {
    await _cacheManager.open();
    final settings = await _cacheManager.getSettings();
    final selectedCode = settings['language']?['code']?.toString();
    if (selectedCode != null) {
      final index = _languages.indexWhere((language) => language['code'] == selectedCode);
      if (index >= 0 && mounted) {
        setState(() => _selectedLanguageIndex = index);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Language'),
        centerTitle: true,
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: _languages.length,
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (context, index) {
                final language = _languages[index];
                final isSelected = _selectedLanguageIndex == index;

                return GestureDetector(
                  onTap: () => setState(() => _selectedLanguageIndex = index),
                  child: Container(
                    decoration: BoxDecoration(
                      border: Border.all(
                        color: isSelected ? TruxifyColors.accent : (Theme.of(context).brightness == Brightness.dark ? TruxifyColors.darkBorder : TruxifyColors.border),
                        width: isSelected ? 2 : 1,
                      ),
                      borderRadius: BorderRadius.circular(12),
                      color: isSelected
                          ? TruxifyColors.accent.withValues(alpha: 0.08)
                          : Theme.of(context).colorScheme.surface,
                    ),
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                language['name'] ?? '',
                                style: Theme.of(context).textTheme.labelMedium?.copyWith(
                                      fontWeight: FontWeight.w600,
                                    ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                language['native'] ?? '',
                                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                      color: TruxifyColors.adaptiveSecondaryText(context),
                                    ),
                              ),
                            ],
                          ),
                        ),
                        if (isSelected)
                          const Icon(Icons.check_circle_rounded, color: TruxifyColors.accent, size: 24),
                      ],
                    ),
                  ),
                );
              },
            ),
            const SizedBox(height: 32),
            PrimaryButton(
              label: 'Apply',
              onPressed: () async {
                await _cacheManager.open();
                await _cacheManager.cacheSettings({
                  'language': {
                    'code': _languages[_selectedLanguageIndex]['code'],
                    'name': _languages[_selectedLanguageIndex]['name']
                  },
                });
                if (!mounted) return;
                _showLanguageChangedSnackBar();
                Navigator.of(context).pop();
              },
            ),
          ],
        ),
      ),
    );
  }
}
