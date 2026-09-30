// Get driver statement and earnings report
const getDriverStatement = async (req, res) => {
  try {
    const driverId = req.user?.id || req.user?._id;
    const { startDate, endDate } = req.query;

    if (!driverId) {
      return res.status(401).json({
        success: false,
        message: 'Driver authentication required',
      });
    }

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'startDate and endDate are required',
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date range',
      });
    }

    if (start > end) {
      return res.status(400).json({
        success: false,
        message: 'startDate must be before endDate',
      });
    }

    // Fetch completed driver earnings for the requested period.
    // Adjust the model/query below to match your existing Order/Earning model.
    const orders = await Order.find({
      driver: driverId,
      status: 'completed',
      completedAt: {
        $gte: start,
        $lte: end,
      },
    }).lean();

    const totals = orders.reduce(
      (result, order) => {
        const baseFreight = Number(order.baseFreight || order.freightAmount || 0);
        const platformFee = Number(order.platformFee || order.platformFees || 0);
        const tollEstimate = Number(order.tollEstimate || order.tollAmount || 0);
        const netEarnings =
          Number(
            order.netEarnings ??
              (baseFreight - platformFee + tollEstimate)
          );

        result.baseFreight += baseFreight;
        result.platformFees += platformFee;
        result.tollEstimates += tollEstimate;
        result.netEarnings += netEarnings;
        result.completedTrips += 1;

        return result;
      },
      {
        baseFreight: 0,
        platformFees: 0,
        tollEstimates: 0,
        netEarnings: 0,
        completedTrips: 0,
      }
    );

    return res.status(200).json({
      success: true,
      data: {
        driverId,
        period: {
          startDate,
          endDate,
        },
        totals,
      },
    });
  } catch (error) {
    console.error('Error retrieving driver statement:', error);

    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve driver statement',
      error: error.message,
    });
  }
};
