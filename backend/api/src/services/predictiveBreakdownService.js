/**
 * Predictive Breakdown Service
 *
 * Handles:
 * - OBD-II / J1939 telemetry evaluation
 * - Breakdown risk calculation
 * - Predictive breakdown alerts
 * - SOS swarm preparation
 *
 * This first version uses rule-based detection.
 */

const DEFAULT_THRESHOLDS = {
  coolantTemperature: {
    warning: 100,
    critical: 110,
  },

  oilPressure: {
    warning: 20,
    critical: 10,
  },

  batteryVoltage: {
    warningLow: 12.0,
    criticalLow: 11.5,
  },
};

const RISK_LEVELS = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
};

/**
 * Safely convert a telemetry value to a number.
 */
function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

/**
 * Evaluate engine coolant temperature.
 */
function evaluateCoolantTemperature(value, thresholds) {
  const temperature = toNumber(value);

  if (temperature === null) {
    return null;
  }

  if (temperature >= thresholds.critical) {
    return {
      type: "COOLANT_OVERHEAT",
      severity: RISK_LEVELS.CRITICAL,
      message: `Critical engine coolant temperature: ${temperature}°C`,
      value: temperature,
    };
  }

  if (temperature >= thresholds.warning) {
    return {
      type: "COOLANT_HIGH",
      severity: RISK_LEVELS.HIGH,
      message: `High engine coolant temperature: ${temperature}°C`,
      value: temperature,
    };
  }

  return null;
}

/**
 * Evaluate engine oil pressure.
 */
function evaluateOilPressure(value, thresholds) {
  const pressure = toNumber(value);

  if (pressure === null) {
    return null;
  }

  if (pressure <= thresholds.critical) {
    return {
      type: "OIL_PRESSURE_CRITICAL",
      severity: RISK_LEVELS.CRITICAL,
      message: `Critical engine oil pressure: ${pressure} psi`,
      value: pressure,
    };
  }

  if (pressure <= thresholds.warning) {
    return {
      type: "OIL_PRESSURE_LOW",
      severity: RISK_LEVELS.HIGH,
      message: `Low engine oil pressure: ${pressure} psi`,
      value: pressure,
    };
  }

  return null;
}

/**
 * Evaluate battery voltage.
 */
function evaluateBatteryVoltage(value, thresholds) {
  const voltage = toNumber(value);

  if (voltage === null) {
    return null;
  }

  if (voltage <= thresholds.criticalLow) {
    return {
      type: "BATTERY_CRITICAL",
      severity: RISK_LEVELS.CRITICAL,
      message: `Critical battery voltage: ${voltage} V`,
      value: voltage,
    };
  }

  if (voltage <= thresholds.warningLow) {
    return {
      type: "BATTERY_LOW",
      severity: RISK_LEVELS.MEDIUM,
      message: `Low battery voltage: ${voltage} V`,
      value: voltage,
    };
  }

  return null;
}

/**
 * Evaluate diagnostic trouble codes.
 *
 * DTCs can come from an OBD-II or J1939 gateway.
 */
function evaluateDtcCodes(dtcCodes) {
  if (!Array.isArray(dtcCodes) || dtcCodes.length === 0) {
    return null;
  }

  return {
    type: "DTC_DETECTED",
    severity:
      dtcCodes.length >= 3
        ? RISK_LEVELS.CRITICAL
        : RISK_LEVELS.HIGH,
    message: `${dtcCodes.length} diagnostic trouble code(s) detected`,
    codes: dtcCodes,
  };
}

/**
 * Calculate the overall breakdown risk.
 */
function calculateRisk(alerts) {
  if (!alerts || alerts.length === 0) {
    return RISK_LEVELS.LOW;
  }

  if (
    alerts.some(
      (alert) => alert.severity === RISK_LEVELS.CRITICAL
    )
  ) {
    return RISK_LEVELS.CRITICAL;
  }

  if (
    alerts.some(
      (alert) => alert.severity === RISK_LEVELS.HIGH
    )
  ) {
    return RISK_LEVELS.HIGH;
  }

  if (
    alerts.some(
      (alert) => alert.severity === RISK_LEVELS.MEDIUM
    )
  ) {
    return RISK_LEVELS.MEDIUM;
  }

  return RISK_LEVELS.LOW;
}

/**
 * Analyze vehicle telemetry.
 *
 * Expected input:
 *
 * {
 *   vehicleId: "TRUCK-001",
 *   coolantTemperature: 105,
 *   oilPressure: 18,
 *   batteryVoltage: 12.2,
 *   dtcCodes: ["P0217"],
 *   latitude: 13.0827,
 *   longitude: 80.2707
 * }
 */
function analyzeTelemetry(telemetry, customThresholds = {}) {
  if (!telemetry || typeof telemetry !== "object") {
    throw new TypeError("Telemetry data must be an object");
  }

  const thresholds = {
    coolantTemperature: {
      ...DEFAULT_THRESHOLDS.coolantTemperature,
      ...(customThresholds.coolantTemperature || {}),
    },

    oilPressure: {
      ...DEFAULT_THRESHOLDS.oilPressure,
      ...(customThresholds.oilPressure || {}),
    },

    batteryVoltage: {
      ...DEFAULT_THRESHOLDS.batteryVoltage,
      ...(customThresholds.batteryVoltage || {}),
    },
  };

  const alerts = [];

  const coolantAlert = evaluateCoolantTemperature(
    telemetry.coolantTemperature,
    thresholds.coolantTemperature
  );

  if (coolantAlert) {
    alerts.push(coolantAlert);
  }

  const oilAlert = evaluateOilPressure(
    telemetry.oilPressure,
    thresholds.oilPressure
  );

  if (oilAlert) {
    alerts.push(oilAlert);
  }

  const batteryAlert = evaluateBatteryVoltage(
    telemetry.batteryVoltage,
    thresholds.batteryVoltage
  );

  if (batteryAlert) {
    alerts.push(batteryAlert);
  }

  const dtcAlert = evaluateDtcCodes(telemetry.dtcCodes);

  if (dtcAlert) {
    alerts.push(dtcAlert);
  }

  const riskLevel = calculateRisk(alerts);

  return {
    vehicleId: telemetry.vehicleId || null,
    riskLevel,
    breakdownPredicted:
      riskLevel === RISK_LEVELS.HIGH ||
      riskLevel === RISK_LEVELS.CRITICAL,
    sosRequired: riskLevel === RISK_LEVELS.CRITICAL,
    alerts,
    location: {
      latitude: toNumber(telemetry.latitude),
      longitude: toNumber(telemetry.longitude),
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a predictive breakdown alert.
 */
function createBreakdownAlert(analysis) {
  if (!analysis.breakdownPredicted) {
    return null;
  }

  return {
    alertType: "PREDICTIVE_BREAKDOWN",
    vehicleId: analysis.vehicleId,
    riskLevel: analysis.riskLevel,
    sosRequired: analysis.sosRequired,
    alerts: analysis.alerts,
    location: analysis.location,
    createdAt: analysis.timestamp,
  };
}

/**
 * Create an SOS swarm request.
 *
 * This only creates the request payload.
 * Integration with notification/location services
 * can be added when their existing APIs are confirmed.
 */
function createSosSwarmRequest(analysis) {
  if (!analysis.sosRequired) {
    return null;
  }

  return {
    type: "BREAKDOWN_SOS_SWARM",
    priority: "CRITICAL",
    vehicleId: analysis.vehicleId,
    location: analysis.location,
    reason: analysis.alerts.map((alert) => alert.message),
    requestedResources: [
      "NEARBY_VERIFIED_MECHANIC",
      "AVAILABLE_TRUXIFY_TRUCK",
    ],
    createdAt: analysis.timestamp,
  };
}

/**
 * Main entry point.
 *
 * Processes telemetry and returns:
 * - risk analysis
 * - predictive alert
 * - SOS swarm request when required
 */
function processTelemetry(telemetry, customThresholds = {}) {
  const analysis = analyzeTelemetry(
    telemetry,
    customThresholds
  );

  const breakdownAlert = createBreakdownAlert(analysis);

  const sosSwarmRequest = createSosSwarmRequest(analysis);

  return {
    analysis,
    breakdownAlert,
    sosSwarmRequest,
  };
}

module.exports = {
  analyzeTelemetry,
  calculateRisk,
  createBreakdownAlert,
  createSosSwarmRequest,
  processTelemetry,
  RISK_LEVELS,
};
