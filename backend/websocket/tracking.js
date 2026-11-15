// backend/websocket/tracking.js (Excerpt)
io.on('connection', (socket) => {
  socket.on('join_tracking', ({ bookingId }) => {
    socket.join(`booking_${bookingId}`);
  });

  socket.on('driver_location_update', (data) => {
    const { bookingId, lat, lng } = data;
    // Broadcast GPS update to all clients in the booking room
    io.to(`booking_${bookingId}`).emit('GPS_UPDATE', {
      event: 'GPS_UPDATE',
      bookingId,
      lat,
      lng,
      timestamp: new Date().toISOString(),
    });
  });
});
