import logger from '../middleware/logger.js';

export const tripValidator = {
  validate: (req, res, next) => {
    const tripId = req.params?.tripId ?? req.params?.id;
    if (tripId === undefined || tripId === null || tripId === '') {
      return res.status(400).json({ error: 'tripId parameter is required' });
    }
    if (tripId !== undefined && tripId !== null) {
      if (typeof tripId !== 'string' || tripId.trim().length === 0) {
        return res.status(400).json({ error: 'Invalid tripId' });
      }
    }
    next();
  }
};
