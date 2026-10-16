// Inside backend/api/src/services/reputationService.js

export async function aggregateRating(userId, roleScore) {
  // Add defensive null/undefined guard for roleScore
  if (!roleScore || typeof roleScore !== 'object') {
    logger.warn({ userId, roleScore }, 'aggregateRating called with missing or invalid roleScore object');
    return {
      aggregatedScore: 0,
      breakdown: null,
    };
  }

  // Safely extract properties with fallback defaults
  const { 
    baseRating = 0, 
    multiplier = 1.0, 
    adjustments = 0 
  } = roleScore;

  try {
    const calculatedScore = (Number(baseRating) * Number(multiplier)) + Number(adjustments);
    
    return {
      aggregatedScore: Number(calculatedScore.toFixed(2)),
      breakdown: {
        baseRating,
        multiplier,
        adjustments,
      }
    };
  } catch (err) {
    logger.error({ userId, error: err.message }, 'Failed to compute aggregated rating score');
    throw err;
  }
}
