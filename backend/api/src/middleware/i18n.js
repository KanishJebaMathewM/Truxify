import i18next from 'i18next';
import middleware from 'i18next-http-middleware';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const enDict = JSON.parse(fs.readFileSync(path.join(__dirname, '../locales/en.json')));
const esDict = JSON.parse(fs.readFileSync(path.join(__dirname, '../locales/es.json')));

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

export const i18nMiddleware = middleware.handle(i18next);

export const errorTranslationInterceptor = (req, res, next) => {
  const originalJson = res.json;
  res.json = function(body) {
    if (body && typeof body === 'object' && typeof body.error === 'string') {
      // Use original English error string as key
      const translated = req.t(body.error, { defaultValue: body.error });
      body.error = translated;
    }
    return originalJson.call(this, body);
  };
  next();
};
