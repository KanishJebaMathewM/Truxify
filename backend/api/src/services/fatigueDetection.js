/**
 * Mock database of safe truck stops and rest areas with verified high-capacity truck parking.
 */
const NEARBY_TRUCK_STOPS = [
    { stopId: 'stop-01', name: "Love's Travel Stop #412", mileMarker: 118, city: 'Harrisburg', state: 'PA', availableParkingSpaces: 34, amenities: ['Showers', 'DEF', 'Restroom'] },
    { stopId: 'stop-02', name: 'Pilot Flying J Travel Center #209', mileMarker: 135, city: 'Carlisle', state: 'PA', availableParkingSpaces: 18, amenities: ['Showers', 'Dining', 'Restroom'] },
    { stopId: 'stop-03', name: 'TA Express Travel Center', mileMarker: 152, city: 'Chambersburg', state: 'PA', availableParkingSpaces: 42, amenities: ['Showers', '24/7 Security', 'Restroom'] }
];

/**
 * Evaluates privacy-preserving biometric telemetry against Hours of Service (HOS) data.
 * 
 * @param {Object} data - { driverId, biometricData, hosRemainingMinutes, currentLocation }
 * @returns {Object} Fatigue assessment report and proactive rest stop routing recommendations
 */
export function evaluateDriverFatigue(data) {
    const {
        driverId,
        biometricData = {},
        hosRemainingMinutes = 600, // Default 10 hours remaining
        currentLocation = {}
    } = data;

    const {
        perclosScore = 0.05,        // Percentage of Eye Closure time (PERCLOS: > 0.15 indicates fatigue)
        blinkRatePerMin = 18,       // Normal range: 12-20 blinks/min
        headNodCount = 0,           // Head nodding detected within 5-minute rolling window
        averageEyeClosureMs = 250   // Micro-sleep indicator (> 500ms indicates drowsy blink)
    } = biometricData;

    // Calculate normalized fatigue index (0.0 to 1.0)
    let fatigueScore = 0.0;

    // PERCLOS impact
    if (perclosScore >= 0.15) fatigueScore += 0.45;
    else if (perclosScore >= 0.10) fatigueScore += 0.25;

    // Micro-sleep / prolonged eye closure impact
    if (averageEyeClosureMs > 500) fatigueScore += 0.35;
    else if (averageEyeClosureMs > 350) fatigueScore += 0.15;

    // Head nod event impact
    if (headNodCount >= 2) fatigueScore += 0.30;
    else if (headNodCount === 1) fatigueScore += 0.15;

    fatigueScore = Math.min(1.0, parseFloat(fatigueScore.toFixed(2)));

    // Categorize Fatigue Level
    let alertLevel = 'NORMAL';
    if (fatigueScore >= 0.65 || (fatigueScore >= 0.45 && hosRemainingMinutes <= 90)) {
        alertLevel = 'CRITICAL_FATIGUE';
    } else if (fatigueScore >= 0.35) {
        alertLevel = 'MODERATE_DROWSINESS';
    }

    const requiresImmediateRest = alertLevel === 'CRITICAL_FATIGUE';

    // Proactively attach safe rest stops if fatigue is detected
    let recommendedRestStops = [];
    if (requiresImmediateRest || alertLevel === 'MODERATE_DROWSINESS') {
        recommendedRestStops = NEARBY_TRUCK_STOPS.map((stop) => ({
            ...stop,
            estimatedDriveTimeMinutes: Math.max(5, Math.ceil((stop.mileMarker - 110) * 1.2))
        }));
    }

    return {
        driverId,
        alertLevel,
        fatigueMetrics: {
            fatigueScore,
            perclosScore,
            headNodCount,
            averageEyeClosureMs,
            hosRemainingMinutes
        },
        requiresImmediateRest,
        actionPrompt: requiresImmediateRest
            ? 'CRITICAL ALERT: Biometric fatigue detected. Rerouting to nearest safe truck stop.'
            : (alertLevel === 'MODERATE_DROWSINESS' ? 'WARNING: Early signs of fatigue detected. Consider taking a rest break.' : 'Driver alertness optimal.'),
        recommendedRestStops
    };
}
