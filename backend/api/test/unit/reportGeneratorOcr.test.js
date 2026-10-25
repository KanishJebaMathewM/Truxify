import { describe, expect, it } from 'vitest';
import { generateCSV, generateHTMLReport, formatDashboardMetrics } from '../../src/lib/reportGenerator.js';
import { parseDocumentText, calculateConfidence } from '../../src/lib/ocrProcessor.js';

describe('reportGenerator.generateCSV', () => {
  it('writes headers + rows in column order', () => {
    const csv = generateCSV(
      [{ name: 'Truck A', trips: 5 }, { name: 'Truck B', trips: 3 }],
      ['name', 'trips']
    );
    expect(csv.split('\n')).toEqual(['name,trips', 'Truck A,5', 'Truck B,3']);
  });

  it('escapes commas, quotes, and newlines per RFC 4180', () => {
    const csv = generateCSV([{ note: 'a,b', q: 'say "hi"', nl: 'x\ny' }], ['note', 'q', 'nl']);
    expect(csv).toBe('note,q,nl\n"a,b","say ""hi""","x\ny"');
  });

  it('null/undefined cells become empty strings', () => {
    const csv = generateCSV([{ a: null, b: undefined, c: 0 }], ['a', 'b', 'c']);
    expect(csv.split('\n')[1]).toBe(',,0');
  });

  it('empty data → empty string', () => {
    expect(generateCSV([], ['a'])).toBe('');
    expect(generateCSV(null)).toBe('');
  });
});

describe('reportGenerator.formatDashboardMetrics', () => {
  it('maps raw metrics into the dashboard shape with defaults', () => {
    const out = formatDashboardMetrics({
      totalDrivers: 40, activeDrivers: 31, utilizationPct: 78,
      onTimePct: 92, averageRating: 4.3, totalTrips: 1200,
      totalRevenue: 900000, totalFuelCost: 300000,
    });
    expect(out.fleetOverview.utilizationRate).toBe(78);
    expect(out.performance.onTimeDeliveryPct).toBe(92);
    expect(out.financial.netProfitPaisa).toBe(600000);
  });

  it('missing metrics default to zero everywhere', () => {
    const out = formatDashboardMetrics({});
    expect(out.fleetOverview.totalDrivers).toBe(0);
    expect(out.financial.netProfitPaisa).toBe(0);
  });
});

describe('reportGenerator.generateHTMLReport', () => {
  it('produces HTML containing the report title', () => {
    const html = generateHTMLReport({ title: 'Q3 Fleet Report', sections: [] });
    expect(html).toContain('<');
    expect(html).toContain('Q3 Fleet Report');
  });
});

describe('ocrProcessor.parseDocumentText', () => {
  it('extracts valid_from/valid_until from two dates on DL-type docs', () => {
    const text = 'DRIVING LICENSE\nNAME: RAJ KUMAR\n01/01/2020\n31/12/2030\nMH0120110000001';
    const out = parseDocumentText(text, 'DL');
    expect(out.valid_from).toBe('01/01/2020');
    expect(out.valid_until).toBe('31/12/2030');
    expect(out.document_number).toBe('MH0120110000001');
    expect(out.name).toBe('RAJ KUMAR');
  });

  it('single date maps to valid_until only', () => {
    const out = parseDocumentText('INSURANCE POLICY\nPOLICY NO AB12CD34\nValid till 01/01/2027', 'INSURANCE');
    expect(out.valid_until).toBe('01/01/2027');
    expect(out.valid_from).toBeUndefined();
  });

  it('non-document text yields no structured fields', () => {
    const out = parseDocumentText('hello world', 'DL');
    expect(out.document_number).toBeUndefined();
    expect(out.valid_until).toBeUndefined();
  });

  it('guards null/non-string input', () => {
    expect(parseDocumentText(null, 'DL')).toEqual({});
    expect(parseDocumentText(42, 'DL')).toEqual({});
  });

  it('DOB pattern extracted when labeled', () => {
    const out = parseDocumentText('NAME: TEST\nDOB: 15/06/1988\nMH0120110000001\n01/01/2020\n01/01/2031', 'DL');
    expect(out.dob).toBe('15/06/1988');
  });
});

describe('ocrProcessor.calculateConfidence', () => {
  it('averages word confidences; empty list → 0', () => {
    expect(calculateConfidence([{ confidence: 80 }, { confidence: 100 }])).toBe(90);
    expect(calculateConfidence([])).toBe(0);
  });
});
