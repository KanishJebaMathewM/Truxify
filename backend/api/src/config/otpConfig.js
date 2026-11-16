// backend/api/src/config/otpConfig.js

export const OTP_CONFIG = {
  length: 6,
  ttlSeconds: 300, // 5 minutes
  regex: /^\d{6}$/,
  minVal: 100000,
  maxVal: 1000000
};
