import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 50 },  // Ramp-up to 50 users over 30s
    { duration: '1m', target: 50 },   // Stay at 50 users for 1m
    { duration: '30s', target: 100 }, // Ramp-up to 100 users
    { duration: '1m', target: 100 },  // Stay at 100 users for 1m
    { duration: '30s', target: 0 },   // Ramp-down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests must complete below 500ms
    http_req_failed: ['rate<0.01'],   // Error rate must be less than 1%
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000/api/v1';
const WS_URL = __ENV.WS_URL || 'ws://localhost:5000/';

export default function () {
  // --- 1. Simulate REST API Traffic (Truck Matching & Profile) ---
  
  // Example REST API request to fetch available trucks nearby
  const trucksRes = http.get(`${BASE_URL}/trucks/search?lat=28.7041&lng=77.1025&radius=50`);
  check(trucksRes, {
    'GET /trucks/search status is 200 or 401': (r) => r.status === 200 || r.status === 401,
  });

  sleep(1);

  // --- 2. Simulate WebSocket GPS Live Tracking ---
  
  // Random Driver ID for simulation
  const driverId = `driver_${Math.floor(Math.random() * 1000)}`;

  const wsResponse = ws.connect(`${WS_URL}?token=mock_token_for_${driverId}`, function (socket) {
    socket.on('open', function () {
      // Simulate sending GPS location updates every 3 seconds
      socket.setInterval(function () {
        const payload = JSON.stringify({
          type: 'GPS_UPDATE',
          driverId: driverId,
          lat: 28.7041 + (Math.random() * 0.01),
          lng: 77.1025 + (Math.random() * 0.01),
          speed: Math.floor(Math.random() * 60),
          timestamp: Date.now()
        });
        socket.send(payload);
      }, 3000);
    });

    socket.on('error', function (e) {
      // Handle error implicitly
    });

    // Close the socket after 10 seconds of simulation
    socket.setTimeout(function () {
      socket.close();
    }, 10000);
  });

  check(wsResponse, { 'WebSocket connection successful': (r) => r && r.status === 101 });

  sleep(2);
}
