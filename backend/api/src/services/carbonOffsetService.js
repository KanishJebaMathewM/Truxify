import crypto from 'crypto';

const CERTIFICATE_SIGNING_SECRET = process.env.CARBON_CERT_SECRET || 'truxify-carbon-signing-key-2026';

/**
 * GLEC (Global Logistics Emissions Council) & EPA SmartWay emission intensity factors (g CO2e per tonne-km).
 */
export const GLEC_EMISSION_FACTORS = Object.freeze({
  diesel: 62.0,           // Standard heavy-duty Class 8 diesel tractor-trailer
  biodiesel_b20: 51.5,    // 20% biodiesel blend
  cng_lng: 48.2,          // Compressed or Liquefied Natural Gas
  electric_grid: 22.0,    // Battery-electric with regional average grid mix
  green_hydrogen: 4.5,    // Fuel-cell electric vehicle powered by green H2
});

export const VEHICLE_AERO_FACTORS = Object.freeze({
  standard: 1.0,
  smartway_certified: 0.88, // Side skirts, trailer tails, low-rolling-resistance tires
  heavy_haul: 1.25,         // Specialized oversized / overweight permits
});

export const OFFSET_PRICE_PER_TON_USD = 15.0;

export const PACKAGES = Object.freeze([
  { id: 'starter', tons: 1, priceUSD: 15.0, description: 'Offset 1 metric ton of CO2 (Gold Standard verified)' },
  { id: 'standard', tons: 5, priceUSD: 70.0, description: 'Offset 5 metric tons of CO2 (VCS + Biochar reforestation)' },
  { id: 'fleet_tier', tons: 25, priceUSD: 325.0, description: 'Offset 25 metric tons of CO2 (Direct air capture portfolio)' },
  { id: 'enterprise', tons: 100, priceUSD: 1200.0, description: 'Offset 100 metric tons of CO2 (Scope 3 institutional retirement)' },
]);

/**
 * Calculates Scope 1 and Scope 3 Well-to-Wheel (WTW) carbon emissions in metric tonnes.
 *
 * @param {Object} params
 * @param {number} params.distanceKm - Distance traversed
 * @param {number} params.weightKg - Payload weight in kilograms
 * @param {string} [params.fuelType='diesel'] - Fuel powertrain type
 * @param {string} [params.vehicleClass='standard'] - Aerodynamic vehicle rating
 * @param {number} [params.emptyBackhaulPercent=0] - Additional deadhead allocation (0-100%)
 * @returns {Object} Calculated emission metrics in tonnes and kilograms
 */
export function calculateFootprint(params) {
  let distanceKm;
  let weightKg;
  let fuelType = 'diesel';
  let vehicleClass = 'standard';
  let emptyBackhaulPercent = 0;

  // Support both object params and legacy (distanceKm, weightKg) signatures
  if (typeof params === 'object' && params !== null) {
    distanceKm = params.distanceKm;
    weightKg = params.weightKg;
    fuelType = params.fuelType || 'diesel';
    vehicleClass = params.vehicleClass || 'standard';
    emptyBackhaulPercent = params.emptyBackhaulPercent || 0;
  } else {
    distanceKm = arguments[0];
    weightKg = arguments[1];
  }

  if (typeof distanceKm !== 'number' || !Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new RangeError('distanceKm must be a non-negative finite number');
  }
  if (typeof weightKg !== 'number' || !Number.isFinite(weightKg) || weightKg < 0) {
    throw new RangeError('weightKg must be a non-negative finite number');
  }

  const normalizedFuel = fuelType.toLowerCase();
  const emissionFactorGrams = GLEC_EMISSION_FACTORS[normalizedFuel] || GLEC_EMISSION_FACTORS.diesel;
  const aeroMultiplier = VEHICLE_AERO_FACTORS[vehicleClass.toLowerCase()] || VEHICLE_AERO_FACTORS.standard;

  const tonnePayload = weightKg / 1000.0;
  const tonneKm = distanceKm * tonnePayload;

  // Include empty repositioning adjustment
  const backhaulMultiplier = 1.0 + Math.max(0, Math.min(100, emptyBackhaulPercent)) / 100.0 * 0.45;

  const totalGramsCO2e = tonneKm * emissionFactorGrams * aeroMultiplier * backhaulMultiplier;
  const totalKgCO2e = totalGramsCO2e / 1000.0;
  const totalTonnesCO2e = totalKgCO2e / 1000.0;

  return {
    distanceKm,
    weightKg,
    tonneKm: parseFloat(tonneKm.toFixed(2)),
    fuelType: normalizedFuel,
    emissionFactorGramsPerTonneKm: emissionFactorGrams,
    carbonKg: parseFloat(totalKgCO2e.toFixed(3)),
    carbonTonnes: parseFloat(totalTonnesCO2e.toFixed(4)),
    estimatedOffsetCostUSD: parseFloat((totalTonnesCO2e * OFFSET_PRICE_PER_TON_USD).toFixed(2)),
  };
}

export function getOffsetPackages() {
  return PACKAGES;
}

/**
 * Generates an HMAC-SHA256 cryptographically verifiable certificate token.
 */
export function signCertificatePayload(payload) {
  const serialized = `${payload.certificateId}:${payload.userId}:${payload.shipmentId}:${payload.tons}:${payload.issuedAt}`;
  return crypto.createHmac('sha256', CERTIFICATE_SIGNING_SECRET).update(serialized).digest('hex');
}

/**
 * Cryptographically verifies an offset certificate against tampering.
 */
export function verifyCarbonCertificate(certificate) {
  if (!certificate || typeof certificate !== 'object') {
    return { valid: false, reason: 'Malformed certificate object' };
  }

  const tons = certificate.tons ?? certificate.tonsOffset;
  const { certificateId, userId, shipmentId, issuedAt, signature } = certificate;
  if (!certificateId || !userId || !shipmentId || tons === undefined || tons === null || !issuedAt || !signature) {
    return { valid: false, reason: 'Missing mandatory certificate claims' };
  }

  const expectedSignature = signCertificatePayload({ certificateId, userId, shipmentId, tons, issuedAt });

  try {
    const valid = crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
    return { valid, reason: valid ? null : 'Cryptographic signature mismatch' };
  } catch {
    return { valid: false, reason: 'Signature decoding error' };
  }
}

/**
 * Purchases and cryptographically signs a certified carbon offset allotment.
 */
export async function purchaseOffset(userId, packageId, shipmentId) {
  if (!userId || typeof userId !== 'string') {
    throw new TypeError('userId is required');
  }
  if (!shipmentId || typeof shipmentId !== 'string') {
    throw new TypeError('shipmentId is required');
  }

  const selectedPackage = PACKAGES.find((pkg) => pkg.id === packageId);
  if (!selectedPackage) {
    throw new Error(`Invalid offset package selected: ${packageId}`);
  }

  const entropy = crypto.randomBytes(8).toString('hex');
  const certificateId = `CERT-CO2-${Date.now()}-${entropy.toUpperCase()}`;
  const issuedAt = new Date().toISOString();

  const certData = {
    certificateId,
    userId,
    shipmentId,
    tons: selectedPackage.tons,
    issuedAt,
  };

  const signature = signCertificatePayload(certData);

  return {
    success: true,
    certificateId,
    userId,
    shipmentId,
    package: selectedPackage,
    tons: selectedPackage.tons,
    tonsOffset: selectedPackage.tons,
    pricePaidUSD: selectedPackage.priceUSD,
    issuedAt,
    signature,
    verificationUrl: `/api/carbon-offset/verify/${certificateId}`,
    message: 'Carbon offset allotment certified and cryptographically sealed.',
  };
}

export default {
  calculateFootprint,
  getOffsetPackages,
  signCertificatePayload,
  verifyCarbonCertificate,
  purchaseOffset,
  GLEC_EMISSION_FACTORS,
  VEHICLE_AERO_FACTORS,
  OFFSET_PRICE_PER_TON_USD,
  PACKAGES,
};
