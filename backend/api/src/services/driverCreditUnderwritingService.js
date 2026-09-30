/**
 * @fileoverview Driver Credit Underwriting & Risk Assessment Engine for Fuel Advances.
 * 
 * Responsibilities:
 * 1. Computes driver creditworthiness score (0-100) using historical trip completion,
 *    on-chain reputation, dispute history, and active freight receivables.
 * 2. Determines allowable advance percentage tier (0%, 30%, or 40%).
 */

import logger from '../middleware/logger.js';
import { DomainError } from './order/domainError.js';

/**
 * Evaluates driver creditworthiness and maximum advance allocation.
 * 
 * @param {Object} driverProfile - { driverId, completedTrips, averageRating, onTimeRate, disputeCount, totalFreightValueInr }
 * @returns {Object} Underwriting decision with score, tier, and max advance amount
 */
export function evaluateDriverCredit(driverProfile) {
  const {
    driverId,
    completedTrips = 0,
    averageRating = 4.5,
    onTimeRate = 0.95,
    disputeCount = 0,
    totalFreightValueInr = 0,
  } = driverProfile;

  if (!driverId) {
    throw new DomainError(400, { error: 'driverId is required for credit underwriting' });
  }

  let creditScore = 0;

  // 1. Completed Trips Weight (Max 30 pts)
  const tripsScore = Math.min(30, completedTrips * 2);
  creditScore += tripsScore;

  // 2. Rating Weight (Max 25 pts)
  if (averageRating >= 4.8) creditScore += 25;
  else if (averageRating >= 4.5) creditScore += 20;
  else if (averageRating >= 4.0) creditScore += 15;
  else if (averageRating >= 3.5) creditScore += 5;

  // 3. On-Time Delivery Rate Weight (Max 25 pts)
  if (onTimeRate >= 0.95) creditScore += 25;
  else if (onTimeRate >= 0.85) creditScore += 15;
  else if (onTimeRate >= 0.75) creditScore += 10;

  // 4. Active Freight Collateral Weight (Max 20 pts)
  if (totalFreightValueInr > 0) creditScore += 20;

  // 5. Deductions for Disputes / Defaults
  const disputePenalty = disputeCount * 20;
  creditScore = Math.max(0, Math.min(100, creditScore - disputePenalty));

  // Determine Advance Allocation Tier
  let maxAdvancePercentage = 0;
  let isEligible = false;
  let underwritingTier = 'INELIGIBLE';

  if (creditScore >= 80) {
    maxAdvancePercentage = 40;
    isEligible = true;
    underwritingTier = 'TIER_1_PRIME';
  } else if (creditScore >= 60) {
    maxAdvancePercentage = 30;
    isEligible = true;
    underwritingTier = 'TIER_2_STANDARD';
  } else {
    maxAdvancePercentage = 0;
    isEligible = false;
    underwritingTier = 'TIER_3_INELIGIBLE';
  }

  const maxAdvanceAmountInr = Number(((maxAdvancePercentage / 100) * totalFreightValueInr).toFixed(2));

  logger.info(
    { driverId, creditScore, underwritingTier, maxAdvancePercentage, maxAdvanceAmountInr },
    '[driverCreditUnderwritingService] Driver credit evaluated'
  );

  return {
    driverId,
    creditScore,
    underwritingTier,
    isEligible,
    maxAdvancePercentage,
    maxAdvanceAmountInr,
    factors: {
      completedTrips,
      averageRating,
      onTimeRate: Number((onTimeRate * 100).toFixed(1)) + '%',
      disputeCount,
      totalFreightValueInr,
    },
  };
}

export default {
  evaluateDriverCredit,
};
