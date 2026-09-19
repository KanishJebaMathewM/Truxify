/**
 * @fileoverview Admin endpoints for managing translations and public locale endpoints.
 */

import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/db.js';
import { loadTranslations, clearTranslationCache, translate } from '../services/i18nService.js';
import { SUPPORTED_LOCALES, isRTL } from '../lib/formatters.js';
import logger from '../middleware/logger.js';

const router = express.Router();

/**
 * GET /api/i18n/locales
 * Returns list of supported locales with metadata.
 */
router.get('/locales', (req, res) => {
    const locales = SUPPORTED_LOCALES.map(locale => ({
        code: locale,
        language: locale.split('-')[0],
        region: locale.split('-')[1] || null,
        isRTL: isRTL(locale)
    }));

    res.json({ success: true, locales });
});

/**
 * GET /api/i18n/translations/:locale
 * Returns all translations for a locale (public, cached).
 */
router.get('/translations/:locale', async (req, res) => {
    try {
        const { locale } = req.params;

        if (!SUPPORTED_LOCALES.includes(locale)) {
            return res.status(400).json({ error: 'Unsupported locale' });
        }

        const translations = await loadTranslations(locale);

        res.json({
            success: true,
            locale,
            translations,
            isRTL: isRTL(locale)
        });
    } catch (err) {
        logger.error({ err }, 'GET /i18n/translations/:locale error');
        res.status(500).json({ error: 'Failed to load translations' });
    }
});

/**
 * POST /api/i18n/translate
 * Translates a single key on-demand (useful for testing).
 */
router.post('/translate', async (req, res) => {
    try {
        const { key, variables, locale = 'en-IN' } = req.body;

        if (!key) {
            return res.status(400).json({ error: 'key is required' });
        }

        const translated = await translate(key, variables || {}, locale);

        res.json({ success: true, key, locale, translated });
    } catch (err) {
        logger.error({ err }, 'POST /i18n/translate error');
        res.status(500).json({ error: 'Translation failed' });
    }
});

/**
 * POST /api/i18n/admin/translations
 * Admin: Create or update a translation.
 */
router.post('/admin/translations', authenticate, requireRole(['admin']), async (req, res) => {
    try {
        const { locale, key, value, plural_forms } = req.body;

        if (!locale || !key || (!value && !plural_forms)) {
            return res.status(400).json({ error: 'locale, key, and value/plural_forms are required' });
        }

        if (!SUPPORTED_LOCALES.includes(locale)) {
            return res.status(400).json({ error: 'Unsupported locale' });
        }

        const payload = {
            locale,
            key,
            value: value || null,
            plural_forms: plural_forms ? JSON.stringify(plural_forms) : null,
            updated_at: new Date().toISOString()
        };

        const { error } = await supabaseAdmin
            .from('translations')
            .upsert(payload, { onConflict: 'locale,key' });

        if (error) throw error;

        // Invalidate cache
        await clearTranslationCache(locale);

        res.json({ success: true, message: 'Translation saved' });
    } catch (err) {
        logger.error({ err }, 'POST /i18n/admin/translations error');
        res.status(500).json({ error: 'Failed to save translation' });
    }
});

/**
 * DELETE /api/i18n/admin/translations/:locale/:key
 * Admin: Delete a translation.
 */
router.delete('/admin/translations/:locale/:key', authenticate, requireRole(['admin']), async (req, res) => {
    try {
        const { locale, key } = req.params;

        const { error } = await supabaseAdmin
            .from('translations')
            .delete()
            .eq('locale', locale)
            .eq('key', key);

        if (error) throw error;

        await clearTranslationCache(locale);

        res.json({ success: true, message: 'Translation deleted' });
    } catch (err) {
        logger.error({ err }, 'DELETE /i18n/admin/translations error');
        res.status(500).json({ error: 'Failed to delete translation' });
    }
});

/**
 * POST /api/i18n/admin/cache/clear
 * Admin: Force clear translation cache.
 */
router.post('/admin/cache/clear', authenticate, requireRole(['admin']), async (req, res) => {
    try {
        const { locale } = req.body;
        await clearTranslationCache(locale || null);

        res.json({ success: true, message: 'Cache cleared' });
    } catch (err) {
        logger.error({ err }, 'POST /i18n/admin/cache/clear error');
        res.status(500).json({ error: 'Failed to clear cache' });
    }
});

export default router;
