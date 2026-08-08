import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 500 },
    { duration: '1m', target: 500 },
    { duration: '30s', target: 0 },
  ],
};

export default function () {
  const BASE_URL = __ENV.API_BASE_URL || 'http://localhost:5000';
  const params = {
    headers: {
      'x-user-id': '22222222-2222-2222-2222-222222222222',
      'x-user-role': 'driver',
      'Content-Type': 'application/json',
    },
  };

  const healthRes = http.get(`${BASE_URL}/health`, params);
  check(healthRes, {
    'status is 200': (r) => r.status === 200,
  });

  const availableLoadsRes = http.get(`${BASE_URL}/api/loads/available`, params);
  check(availableLoadsRes, {
    'status is 200': (r) => r.status === 200,
  });

  sleep(1);
}
