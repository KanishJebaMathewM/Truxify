import logger from '../middleware/logger.js';

export const tripValidator = {
  validate: (req, res, next) => {
    const tripId = req.params.tripId ?? req.params.id;
    if (tripId !== undefined) {
      if (typeof tripId !== 'string' || tripId.length < 1) {
        return res.status(400).json({ error: 'Invalid trip ID' });
      }
    }
    next();
  }
};