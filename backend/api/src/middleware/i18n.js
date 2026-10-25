/**
 * Internationalization (i18n) Middleware
 * 
 * Detects and resolves user locale preferences from headers or query parameters,
 * attaching translation dictionaries or helper functions to the request.
 * Uses structured warning logging for locale loading failures.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import i18next from 'i18next';
import middleware from 'i18next-http-middleware';
import logger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_LOCALE = 'en';
const SUPPORTED_LOCALES = ['en', 'ta', 'hi', 'es'];

export const supportedLocales = ['en', 'es', 'fr', 'de', 'ta'];
export const defaultLocale = 'en';

// Cache loaded translation dictionaries to prevent repetitive disk I/O
const translationCache = {};

const enDict = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '../locales/en.json'), 'utf8'));
  } catch (err) {
    logger.warn(
      { event: 'I18N_LOCALE_LOAD_ERROR', locale: 'en', error: err && err.message },
      '[i18n] Failed to load en.json locale, falling back to empty object'
    );
    return {};
  }
})();

const esDict = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '../locales/es.json'), 'utf8'));
  } catch (err) {
    logger.warn(
      { event: 'I18N_LOCALE_LOAD_ERROR', locale: 'es', error: err && err.message },
      '[i18n] Failed to load es.json locale, falling back to empty object'
    );
    return {};
  }
})();

/**
 * Resolves the preferred locale from request headers or query parameters.
 * @param {Object} req - Express request object.
 * @returns {string} Resolved locale code.
 */
export function resolveLocale(req) {
  const queryLocale = req.query?.lang || req.query?.locale;
  if (queryLocale && supportedLocales.includes(queryLocale)) {
    return queryLocale;
  }

  const acceptHeader = req.headers?.['accept-language'];
  if (acceptHeader) {
    const primaryLang = acceptHeader.split(',')[0].substring(0, 2).toLowerCase();
    if (supportedLocales.includes(primaryLang)) {
      return primaryLang;
    }
  }

  return defaultLocale;
}

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
      const queryLocale = req.query?.lang || req.query?.locale;
      const acceptHeader = req.headers?.['accept-language'];
      
      let detectedLocale = defaultLang;

      if (queryLocale && SUPPORTED_LOCALES.includes(queryLocale)) {
        detectedLocale = queryLocale;
      } else if (acceptHeader) {
        const primaryLang = acceptHeader.split(',')[0].split('-')[0].trim();
        if (SUPPORTED_LOCALES.includes(primaryLang)) {
          detectedLocale = primaryLang;
        }
      }

      let dictionary = loadLocaleDictionary(detectedLocale);
      if (!dictionary && detectedLocale !== DEFAULT_LOCALE) {
        detectedLocale = DEFAULT_LOCALE;
        dictionary = loadLocaleDictionary(DEFAULT_LOCALE);
      }

      req.locale = detectedLocale;
      req.t = (key, interpolations = {}) => {
        let text = dictionary?.[key] || translationCache[DEFAULT_LOCALE]?.[key] || key;
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

i18next
  .use(middleware.LanguageDetector)
  .init({
    preload: ['en', 'es'],
    fallbackLng: 'en',
    resources: {
      en: { translation: enDict },
      es: { translation: esDict }
    }
  });

export const errorTranslationInterceptor = (req, res, next) => {
  const originalJson = res.json;
  res.json = function(body) {
    if (body !== null && body && typeof body === 'object' && typeof body.error === 'string') {
      if (typeof req?.t === 'function') {
        const translated = req.t(body.error, { defaultValue: body.error });
        body.error = translated;
      }
    }
    return originalJson.call(this, body);
  };
  next();
};

export default errorTranslationInterceptor;
