import { describe, expect, it } from 'vitest';
import { getPluralCategory, pluralize, formatMessage } from '../../src/lib/pluralizer.js';
import { parseAcceptLanguage } from '../../src/lib/localeDetector.js';
import { formatNumber, formatCurrency, isRTL, SUPPORTED_LOCALES } from '../../src/lib/formatters.js';

describe('pluralizer', () => {
  it('English: one vs other', () => {
    expect(getPluralCategory(1, 'en')).toBe('one');
    expect(getPluralCategory(0, 'en')).toBe('other');
    expect(getPluralCategory(5, 'en')).toBe('other');
  });

  it('Hindi/Bengali/Punjabi treat 0 as singular', () => {
    for (const loc of ['hi', 'bn', 'pa']) {
      expect(getPluralCategory(0, loc)).toBe('one');
      expect(getPluralCategory(1, loc)).toBe('one');
      expect(getPluralCategory(2, loc)).toBe('other');
    }
  });

  it('Arabic full rule set: zero/one/two/few/many/other', () => {
    expect(getPluralCategory(0, 'ar')).toBe('zero');
    expect(getPluralCategory(1, 'ar')).toBe('one');
    expect(getPluralCategory(2, 'ar')).toBe('two');
    expect(getPluralCategory(5, 'ar')).toBe('few');     // 3-10
    expect(getPluralCategory(50, 'ar')).toBe('many');   // 11-99
    expect(getPluralCategory(102, 'ar')).toBe('other'); // 102 % 100 = 2 → 'two'? no: 102%100=2 → 'two'
  });

  it('unknown locale falls back to English rules', () => {
    expect(getPluralCategory(1, 'xx')).toBe('one');
    expect(getPluralCategory(3, 'xx')).toBe('other');
  });

  it('pluralize picks the category form and substitutes {count}', () => {
    const forms = { one: '{count} load', other: '{count} loads' };
    expect(pluralize(1, forms, 'en')).toBe('1 load');
    expect(pluralize(7, forms, 'en')).toBe('7 loads');
  });

  it('pluralize falls back to other, then to the first available form', () => {
    expect(pluralize(0, { one: 'single' }, 'ar')).toBe('single'); // no zero/other → first key
    expect(pluralize(3, { few: '{count} pieces' }, 'ar')).toBe('3 pieces');
  });

  it('pluralize guards malformed inputs', () => {
    expect(pluralize(1, null, 'en')).toBe('');
    expect(pluralize(1, 'junk', 'en')).toBe('');
    expect(pluralize(2, {}, 'en')).toBe('');
  });

  it('formatMessage substitutes multiple variables', () => {
    expect(formatMessage('Hello {name}, {count} orders', { name: 'Ram', count: 5 }))
      .toBe('Hello Ram, 5 orders');
  });
});

describe('localeDetector.parseAcceptLanguage', () => {
  it('respects quality ordering', () => {
    expect(parseAcceptLanguage('en-US,en;q=0.9,hi-IN;q=0.8')).toBe('en-IN'); // en-US→en-IN via language match? en-US not in list; en → en-IN
  });

  it('exact supported match wins over higher-q unsupported', () => {
    expect(parseAcceptLanguage('xx-ZZ;q=1.0,ta-IN;q=0.5')).toBe('ta-IN');
  });

  it('language-only codes map to the Indian variant', () => {
    expect(parseAcceptLanguage('hi')).toBe('hi-IN');
    expect(parseAcceptLanguage('ta;q=0.9')).toBe('ta-IN');
  });

  it('no match returns null; missing header returns null', () => {
    expect(parseAcceptLanguage('zz-ZZ')).toBeNull();
    expect(parseAcceptLanguage('')).toBeNull();
    expect(parseAcceptLanguage(undefined)).toBeNull();
  });
});

describe('formatters', () => {
  it('formatNumber/formatCurrency render en-IN grouping', () => {
    expect(formatNumber(1234567.89, 'en-IN')).toBe('12,34,567.89');
    const cur = formatCurrency(50000, 'en-IN', 'INR');
    expect(cur).toContain('50,000');
  });

  it('isRTL only for RTL locales', () => {
    expect(isRTL('ur-IN')).toBe(true);
    expect(isRTL('en-IN')).toBe(false);
  });

  it('SUPPORTED_LOCALES are all xx-IN Indian variants', () => {
    expect(SUPPORTED_LOCALES.length).toBeGreaterThan(5);
    for (const l of SUPPORTED_LOCALES) expect(l).toMatch(/-IN$/);
  });
});
