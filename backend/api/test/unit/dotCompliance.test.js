import { describe, it, expect } from 'vitest';
import { evaluateDriverCompliance } from '../../src/services/dotCompliance.js';

describe('dotCompliance service', () => {
  const futureDate = (daysAhead) => {
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    return d.toISOString();
  };

  const pastDate = (daysAgo) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString();
  };

  it('reports fully compliant when all documents have plenty of time remaining', () => {
    const result = evaluateDriverCompliance({
      driverId: 'driver-101',
      cdlExpiration: futureDate(180),
      medicalCardExpiration: futureDate(120),
      hazmatExpiration: futureDate(90)
    });

    expect(result.driverId).toBe('driver-101');
    expect(result.isFullyCompliant).toBe(true);
    expect(result.actionRequired).toBe(false);
    expect(result.promptBookingAlert).toBe(false);
    expect(result.recommendedClinics).toEqual([]);

    expect(result.documents.CDL.status).toBe('VALID');
    expect(result.documents.MEDICAL_CARD.status).toBe('VALID');
    expect(result.documents.HAZMAT.status).toBe('VALID');
  });

  it('flags medical card expiring soon (within 30 days) and recommends clinics', () => {
    const result = evaluateDriverCompliance({
      driverId: 'driver-102',
      cdlExpiration: futureDate(180),
      medicalCardExpiration: futureDate(15),
      hazmatExpiration: futureDate(90)
    });

    expect(result.isFullyCompliant).toBe(false);
    expect(result.actionRequired).toBe(true);
    expect(result.promptBookingAlert).toBe(true);
    expect(result.documents.MEDICAL_CARD.status).toBe('EXPIRING_SOON');
    expect(result.recommendedClinics.length).toBeGreaterThan(0);
    expect(result.recommendedClinics[0]).toHaveProperty('clinicId');
    expect(result.recommendedClinics[0]).toHaveProperty('estimatedDetourMinutes', 10);
  });

  it('marks expired document as EXPIRED and requires action', () => {
    const result = evaluateDriverCompliance({
      driverId: 'driver-103',
      cdlExpiration: pastDate(5),
      medicalCardExpiration: futureDate(90)
    });

    expect(result.isFullyCompliant).toBe(false);
    expect(result.actionRequired).toBe(true);
    expect(result.documents.CDL.status).toBe('EXPIRED');
    expect(result.promptBookingAlert).toBe(false); // only medical card triggers clinic prompt
    expect(result.recommendedClinics).toEqual([]);
  });

  it('handles expired medical card and triggers clinic alert', () => {
    const result = evaluateDriverCompliance({
      driverId: 'driver-104',
      cdlExpiration: futureDate(60),
      medicalCardExpiration: pastDate(2)
    });

    expect(result.isFullyCompliant).toBe(false);
    expect(result.actionRequired).toBe(true);
    expect(result.promptBookingAlert).toBe(true);
    expect(result.documents.MEDICAL_CARD.status).toBe('EXPIRED');
    expect(result.recommendedClinics.length).toBeGreaterThan(0);
  });

  it('ignores omitted document fields gracefully', () => {
    const result = evaluateDriverCompliance({
      driverId: 'driver-105'
    });

    expect(result.driverId).toBe('driver-105');
    expect(result.isFullyCompliant).toBe(true);
    expect(result.documents).toEqual({});
    expect(result.recommendedClinics).toEqual([]);
  });
});
