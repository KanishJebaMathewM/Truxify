/**
 * Internationalization (i18n) Middleware
 * 
 * Detects and resolves user locale preferences from headers or query parameters,
 * attaching translation dictionaries or helper functions to the request.
 * Uses structured warning logging for locale loading failures.
 */

import fs from 'fs';
import path from 'path';
import logger from './logger.js';

const DEFAULT_LOCALE = 'en';
const SUPPORTED_LOCALES = ['en', 'ta', 'hi', 'es'];

// Cache loaded translation dictionaries to prevent repetitive disk I/O
const translationCache = {};

function loadLocaleDictionary(locale) {
  if (translationCache[locale]) {
    return translationCache[locale];
  }

  try {
    const filePath = path.resolve(process.cwd(), 'src', 'locales', `${locale}.json`);
    if (fs.existsSync(filePath)) {
      const rawData = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(rawData);
      translationCache[locale] = parsed;
      return parsed;
    }
  } catch (err) {
    // Replaced console.warn with structured logger.warn
    logger.warn(
      {
        event: 'I18N_LOCALE_LOAD_ERROR',
        locale,
        error: err?.message || err,
      },
      `Failed to load locale dictionary for "${locale}"`
    );
  }

  return null;
}

export function i18n(defaultLang = DEFAULT_LOCALE) {
  return (req, res, next) => {
    try {
      // Extract locale from query parameter, Accept-Language header, or default
      const queryLocale = req.query.lang || req.query.locale;
      const acceptHeader = req.headers['accept-language'];
      
      let detectedLocale = defaultLang;

      if (queryLocale && SUPPORTED_LOCALES.includes(queryLocale)) {
        detectedLocale = queryLocale;
      } else if (acceptHeader) {
        const primaryLang = acceptHeader.split(',')[0].split('-')[0].trim();
        if (SUPPORTED_LOCALES.includes(primaryLang)) {
          detectedLocale = primaryLang;
        }
      }

      // Load dictionary (falls back to default if target fails)
      let dictionary = loadLocaleDictionary(detectedLocale);
      if (!dictionary && detectedLocale !== DEFAULT_LOCALE) {
        detectedLocale = DEFAULT_LOCALE;
        dictionary = loadLocaleDictionary(DEFAULT_LOCALE);
      }

      req.locale = detectedLocale;
      req.t = (key, interpolations = {}) => {
        let text = dictionary?.[key] || translationCache[DEFAULT_LOCALE]?.[key] || key;
        // Simple interpolation replacement (e.g. {{name}})
        Object.keys(interpolations).forEach((placeholder) => {
          text = text.replace(new RegExp(`{{${placeholder}}}`, 'g'), interpolations[placeholder]);
        });
        return text;
      };

      next();
    } catch (err) {
      logger.error(
        {
          event: 'I18N_MIDDLEWARE_ERROR',
          requestId: req.requestId || req.id,
          error: err?.message || err,
        },
        'Unexpected error in i18n middleware'
      );
      req.locale = DEFAULT_LOCALE;
      req.t = (key) => key;
      next();
    }
  };
}

export default i18n;
