import logger from '../middleware/logger.js';

export function setupTrackerSocket(io) {
  io.on('connection', (socket) => {
    const clientId = socket.id;

    // Replaced console.log with structured logger.info
    logger.info({ clientId }, 'Client connected to tracker socket');

    socket.on('track:location', (data) => {
      try {
        if (!data || !data.lat || !data.lng) {
          // Replaced console.warn with structured logger.warn
          logger.warn({ clientId, data }, 'Received invalid location tracking payload');
          return;
        }

        // Processing location...
        logger.info({ clientId, lat: data.lat, lng: data.lng }, 'Location updated successfully');
      } catch (err) {
        // Replaced console.error with structured logger.error and full error context
        logger.error({ err, clientId }, 'Error processing location tracking event');
      }
    });

    socket.on('disconnect', (reason) => {
      // Replaced console.log with structured logger.info
      logger.info({ clientId, reason }, 'Client disconnected from tracker socket');
    });
  });
}

export default setupTrackerSocket;
