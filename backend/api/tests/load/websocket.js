import ws from 'k6/ws';
import { check } from 'k6';

export const options = {
  vus: 100,
  duration: '1m',
};

export default function () {
  const WS_URL = __ENV.WS_BASE_URL || 'ws://localhost:5000';
  const params = {
    headers: {
      'x-user-id': '22222222-2222-2222-2222-222222222222',
      'x-user-role': 'driver',
      'Content-Type': 'application/json',
    },
  };

  const res = ws.connect(WS_URL, params, function (socket) {
    socket.on('open', () => {
      socket.send(
        JSON.stringify({
          type: 'LOCATION_UPDATE',
          lat: 28.7041,
          lng: 77.1025,
        })
      );

      socket.setTimeout(() => {
        socket.close();
      }, 10000);
    });
  });

  check(res, {
    'connected successfully': (r) => r && r.status === 101,
  });
}
