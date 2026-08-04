import express from 'express';
const router = express.Router();

// Helper: returns start of period (defaults to current month)
function getPeriodStart(period) {
  const now = new Date();
  if (period === 'weekly') {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return d;
  }
  // monthly (default)
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

// GET /api/earnings/summary?period=monthly|weekly
// Auth: Bearer token required (placeholder — wire to your auth middleware)
router.get('/summary', async (req, res) => {
  try {
    const { period = 'monthly' } = req.query;
    const driverId = req.user?.id ?? 'demo-driver'; // replace with real auth

    // TODO: replace with real DB query once Trip model is wired
    // Placeholder response that matches the proposed schema exactly
    const mockTrips = [
      {
        _id: 'trip_001',
        completedAt: new Date(),
        freightValue: 12000,
        fuelCost: 2000,
        tollCost: 300,
        distance: 420,
      },
      {
        _id: 'trip_002',
        completedAt: new Date(Date.now() - 86400000),
        freightValue: 9500,
        fuelCost: 1800,
        tollCost: 200,
        distance: 310,
      },
    ];

    const periodStart = getPeriodStart(period);
    const trips = mockTrips.filter(
      (t) => new Date(t.completedAt) >= periodStart
    );

    const totalGross = trips.reduce((sum, t) => sum + t.freightValue, 0);
    const totalDeductions = trips.reduce(
      (sum, t) => sum + t.fuelCost + t.tollCost,
      0
    );

    const summary = {
      period,
      driverId,
      totalGross,
      totalDeductions,
      netEarnings: totalGross - totalDeductions,
      tripCount: trips.length,
      brokerSavingsPercent:
        totalGross > 0
          ? Math.round(((totalGross * 0.35) / totalGross) * 100)
          : 35, // 35% = typical broker commission saved
      trips: trips.map((t) => ({
        id: t._id,
        date: t.completedAt,
        distance: t.distance,
        gross: t.freightValue,
        deductions: t.fuelCost + t.tollCost,
        net: t.freightValue - t.fuelCost - t.tollCost,
      })),
    };

    res.json({ success: true, data: summary });
  } catch (err) {
    console.error('Earnings summary error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;