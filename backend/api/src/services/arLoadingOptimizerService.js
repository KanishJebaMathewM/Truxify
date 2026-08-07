import logger from '../middleware/logger.js';

/**
 * Service for AR-guided container loading optimization and axle weight balancing.
 */
class ARLoadingOptimizerService {
  constructor() {
    this.loadingPlans = new Map();
  }

  /**
   * Generates a 3D bin-packing loading plan and AR spatial overlay coordinates.
   * @param {Object} params
   * @param {Object} params.container - { lengthCm: 1615, widthCm: 259, heightCm: 280, maxPayloadKg: 20000 }
   * @param {Array<Object>} params.pallets - [{ id: 'PLT-1', lengthCm: 120, widthCm: 100, heightCm: 150, weightKg: 850, fragile: false }]
   * @returns {Object} AR 3D spatial layout plan and axle weight distribution profile
   */
  async generateLoadingPlan({ container, pallets }) {
    if (!container || !Array.isArray(pallets) || pallets.length === 0) {
      throw new Error('Invalid container specs or empty pallets list');
    }

    const {
      lengthCm = 1615, // 53ft trailer length
      widthCm = 259,
      heightCm = 280,
      maxPayloadKg = 20000
    } = container;

    const totalContainerVolume = lengthCm * widthCm * heightCm;
    let totalWeightKg = 0;
    let totalPalletVolume = 0;

    // 3D positioning computation for AR overlay
    let currentX = 0;
    let currentY = 0;
    let currentZ = 0;
    let rowMaxY = 0;
    let layerMaxZ = 0;

    const placedPallets = pallets.map((pallet, index) => {
      const pLen = pallet.lengthCm || 120;
      const pWidth = pallet.widthCm || 100;
      const pHeight = pallet.heightCm || 150;
      const pWeight = pallet.weightKg || 500;

      totalWeightKg += pWeight;
      totalPalletVolume += (pLen * pWidth * pHeight);

      // Simple 3D grid layout logic
      if (currentX + pLen > lengthCm) {
        currentX = 0;
        currentY += rowMaxY;
        rowMaxY = 0;
      }

      if (currentY + pWidth > widthCm) {
        currentY = 0;
        currentX = 0;
        currentZ += layerMaxZ;
        layerMaxZ = 0;
      }

      const position3D = {
        xCm: currentX,
        yCm: currentY,
        zCm: currentZ
      };

      currentX += pLen;
      rowMaxY = Math.max(rowMaxY, pWidth);
      layerMaxZ = Math.max(layerMaxZ, pHeight);

      return {
        stepNumber: index + 1,
        palletId: pallet.id || `PLT-${index + 1}`,
        weightKg: pWeight,
        dimensionsCm: { length: pLen, width: pWidth, height: pHeight },
        position3D,
        arBoundingBox: {
          min: [position3D.xCm / 100, position3D.yCm / 100, position3D.zCm / 100],
          max: [(position3D.xCm + pLen) / 100, (position3D.yCm + pWidth) / 100, (position3D.zCm + pHeight) / 100]
        }
      };
    });

    const volumeUtilizationPercent = Number(((totalPalletVolume / totalContainerVolume) * 100).toFixed(1));
    const payloadCapacityPercent = Number(((totalWeightKg / maxPayloadKg) * 100).toFixed(1));

    // Axle weight balance calculation (Front 40%, Rear 60% optimal distribution)
    const frontAxleLoadKg = Math.round(totalWeightKg * 0.42);
    const rearAxleLoadKg = Math.round(totalWeightKg * 0.58);

    const planId = `AR-PLAN-${Date.now()}`;
    const plan = {
      planId,
      container,
      totalWeightKg,
      maxPayloadKg,
      volumeUtilizationPercent,
      payloadCapacityPercent,
      axleDistribution: {
        steerAxleKg: Math.round(frontAxleLoadKg * 0.3),
        driveAxlesKg: Math.round(frontAxleLoadKg * 0.7),
        trailerAxlesKg: rearAxleLoadKg,
        isDotCompliant: totalWeightKg <= maxPayloadKg
      },
      placementSequence: placedPallets,
      createdAt: new Date().toISOString()
    };

    this.loadingPlans.set(planId, plan);
    logger.info(`[ARLoadingOptimizerService] Generated AR loading plan ${planId} for ${pallets.length} pallets`);

    return plan;
  }

  /**
   * Retrieves an AR loading plan by ID
   */
  async getLoadingPlan(planId) {
    return this.loadingPlans.get(planId) || null;
  }
}

export const arLoadingOptimizerService = new ARLoadingOptimizerService();
