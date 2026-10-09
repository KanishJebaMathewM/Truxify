import i18next from 'i18next';
import middleware from 'i18next-http-middleware';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';
import logger from './logger.js'; // Adjust relative import path as needed

// Inside backend/api/src/middleware/i18n.js

let enTranslations = {};
let esTranslations = {};

try {
  enTranslations = await import('../locales/en.json', { assert: { type: 'json' } });
} catch (err) {
  // Replace console.warn with structured logger.warn
  logger.warn({ 
    event: 'I18N_LOCALE_LOAD_FALLBACK',
    locale: 'en',
    error: err.message,
    stack: err.stack 
  }, '[i18n] Failed to load en.json locale, falling back to empty object');
}

try {
  esTranslations = await import('../locales/es.json', { assert: { type: 'json' } });
} catch (err) {
  // Replace console.warn with structured logger.warn
  logger.warn({ 
    event: 'I18N_LOCALE_LOAD_FALLBACK',
    locale: 'es',
    error: err.message,
    stack: err.stack 
  }, '[i18n] Failed to load es.json locale, falling back to empty object');
}
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const enDict = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '../locales/en.json')));
  } catch (err) {
    logger.warn({ event: 'I18N_LOCALE_LOAD_ERROR', locale: 'en', error: err && err.message }, '[i18n] Failed to load en.json locale, falling back to empty object');
    return {};
  }
})();

const esDict = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '../locales/es.json')));
  } catch (err) {
    logger.warn({ event: 'I18N_LOCALE_LOAD_ERROR', locale: 'es', error: err && err.message }, '[i18n] Failed to load es.json locale, falling back to empty object');
    return {};
  }
})();

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
      // Use original English error string as key
      const translated = req.t(body.error, { defaultValue: body.error });
      body.error = translated;
    }
    return originalJson.call(this, body);
  };
  next();
};

export default errorTranslationInterceptor;

