const CARBON_RATE_PER_KG_KM = 0.00015;
const OFFSET_PRICE_PER_TON = 15.0;

const PACKAGES = [
  { id: 'basic', tons: 1, price: 15.0, description: 'Offset 1 ton of CO2' },
  { id: 'standard', tons: 5, price: 70.0, description: 'Offset 5 tons of CO2' },
  { id: 'premium', tons: 10, price: 130.0, description: 'Offset 10 tons of CO2' },
];

const calculateFootprint = (distanceKm, weightKg) => {
  const carbonKg = distanceKm * weightKg * CARBON_RATE_PER_KG_KM;
  return parseFloat((carbonKg / 1000).toFixed(4));
};

const getOffsetPackages = () => {
  return PACKAGES;
};

const purchaseOffset = async (userId, packageId, shipmentId) => {
  const selectedPackage = PACKAGES.find((pkg) => pkg.id === packageId);

  if (!selectedPackage) {
    throw new Error('Invalid offset package selected.');
  }

  const certificateId = `CERT-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  return {
    success: true,
    userId,
    shipmentId,
    package: selectedPackage,
    certificateId,
    issuedAt: new Date().toISOString(),
    message: 'Carbon offset purchased successfully.',
  };
};

module.exports = {
  calculateFootprint,
  getOffsetPackages,
  purchaseOffset,
};
