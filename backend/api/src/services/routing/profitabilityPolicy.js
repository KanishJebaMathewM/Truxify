const MAX_PAISA = BigInt(Number.MAX_SAFE_INTEGER);

export function paisa(value, label) {
  let admitted;
  if (typeof value === 'number' && Number.isSafeInteger(value)) admitted = BigInt(value);
  else if (typeof value === 'bigint') admitted = value;
  else if (typeof value === 'string' && /^(0|[1-9]\d{0,15})$/.test(value)) admitted = BigInt(value);
  else throw new TypeError(`${label} must be a nonnegative safe integer paisa quote`);
  if (admitted < 0n || admitted > MAX_PAISA) throw new RangeError(`${label} is outside safe integer paisa`);
  return admitted;
}

export function finiteNumber(value, label, decimalStrings = false) {
  let admitted = value;
  if (decimalStrings && typeof value === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value) && value.length <= 64) {
    admitted = Number(value);
  }
  if (typeof admitted !== 'number' || !Number.isFinite(admitted)) throw new TypeError(`${label} must be finite`);
  return admitted;
}

export function geographic(point, label, decimalStrings = false) {
  if (!point || typeof point !== 'object' || Array.isArray(point)) throw new TypeError(`${label} must be a coordinate object`);
  const lat = finiteNumber(point.lat, `${label} latitude`, decimalStrings);
  const lng = finiteNumber(point.lng, `${label} longitude`, decimalStrings);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new RangeError(`${label} must be geographic`);
  return Object.freeze({ lat, lng });
}

function reference(value, label, required = false) {
  if (value === undefined && !required) return undefined;
  if ((typeof value === 'string' && value.trim() && value.length <= 256)
      || (Number.isSafeInteger(value) && value >= 0)) return value;
  throw new TypeError(`${label} must identify one load/customer`);
}

function address(value) {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string' || value.length > 2048) throw new TypeError('address must be a bounded string');
  return value;
}

export function admitCandidates(candidates) {
  if (!Array.isArray(candidates) || candidates.length > 1000) throw new TypeError('candidates must be an array of at most 1000 loads');
  return Array.from(candidates, (load, index) => {
    if (index >= 1000) throw new RangeError('candidate admission exceeds bounded work');
    if (!load || typeof load !== 'object' || Array.isArray(load)) throw new TypeError('candidate must be a complete load');
    const { id, customer_id, pickup_address, drop_address, weight_kg, pickup_lat, pickup_lng, drop_lat, drop_lng, price_paisa } = load;
    const pickup = geographic({ lat: pickup_lat, lng: pickup_lng }, 'pickup', true);
    const drop = geographic({ lat: drop_lat, lng: drop_lng }, 'drop', true);
    const weight = weight_kg === undefined || weight_kg === null ? weight_kg : finiteNumber(weight_kg, 'weight', true);
    if (weight !== undefined && weight !== null && weight < 0) throw new RangeError('weight must be nonnegative');
    return Object.freeze({ index, id: reference(id, 'load', true), customer: customer_id === null ? null : reference(customer_id, 'customer'),
      pickupAddress: address(pickup_address), dropAddress: address(drop_address), weight,
      pickup, drop, payout: paisa(price_paisa, 'payout') });
  });
}

/** Exact nonnegative binary64 rational representation, including subnormals. */
export function binaryRatio(value) {
  const admitted = finiteNumber(value, 'ratio input');
  if (admitted < 0) throw new RangeError('ratio input must be nonnegative');
  if (admitted === 0) return { n: 0n, d: 1n };
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, admitted);
  const bits = view.getBigUint64(0);
  const exponent = Number((bits >> 52n) & 0x7ffn);
  const mantissa = (bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n);
  const shift = exponent ? exponent - 1075 : -1074;
  return shift >= 0 ? { n: mantissa << BigInt(shift), d: 1n } : { n: mantissa, d: 1n << BigInt(-shift) };
}

/** Positive exact-product charge; nearest paisa, half upward, without binary64 intermediate rounding. */
export function roundDistanceChargePaisa(distanceKm, ratePaisa) {
  const fraction = binaryRatio(distanceKm);
  const rate = paisa(ratePaisa, 'rate');
  return (2n * fraction.n * rate + fraction.d) / (2n * fraction.d);
}

export function detourPolicy(incremental, direct, limit) {
  if (direct === 0) return incremental === 0 ? { n: 1n, d: 1n } : null;
  if (limit === 0) return incremental === 0 ? { n: 1n, d: 1n } : null;
  const inc = binaryRatio(incremental); const route = binaryRatio(direct); const ratio = binaryRatio(limit);
  const n = inc.n * route.d * ratio.d;
  const d = inc.d * route.n * ratio.n;
  return n > d ? null : { n: d - n, d };
}

export function affinity(net, payout, penalty) {
  return { n: 3n * net * penalty.d + 2n * payout * penalty.n, d: 5n * payout * penalty.d };
}
export function compareAffinity(left, right) {
  const comparison = left.n * right.d - right.n * left.d;
  return comparison > 0n ? 1 : comparison < 0n ? -1 : 0;
}
export function presentedAffinity(score) {
  return Number((2000n * score.n + score.d) / (2n * score.d)) / 1000;
}
