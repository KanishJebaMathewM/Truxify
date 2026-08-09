const parseNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseNumberList = (value, fallback) => {
  if (!value) return fallback;
  const parsed = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  return parsed.length > 0 ? parsed : fallback;
};

export const demandConfig = {
  baseEarningRate: parseNumber(process.env.DEMAND_BASE_EARNING_RATE, 18.50),
  routeMultiplierBase: parseNumber(process.env.DEMAND_ROUTE_MULTIPLIER_BASE, 1.2),
  routeMultiplierStep: parseNumber(process.env.DEMAND_ROUTE_MULTIPLIER_STEP, 0.1),
  next24HoursFactor: parseNumber(process.env.DEMAND_NEXT_24H_FACTOR, 1.1),
  next48HoursFactor: parseNumber(process.env.DEMAND_NEXT_48H_FACTOR, 0.95),
  peakHours: parseNumberList(process.env.DEMAND_PEAK_HOURS, ['08:00 - 10:00', '17:00 - 19:00']),
};
