import refreshTokenService from '../services/refreshTokenService.js';
import jwt from 'jsonwebtoken';

const createAccessToken = (tokenRecord) => jwt.sign(
  {
    id: tokenRecord.user_id,
    uid: tokenRecord.user_id,
    iss: 'truxify-backend-api',
  },
  process.env.JWT_SECRET || 'truxify-jwt-secret-key',
  { expiresIn: '7d' },
);

const JWT_SECRET = process.env.JWT_SECRET || 'truxify-jwt-secret-key';

const createAccessToken = (tokenRecord) => jwt.sign(
  {
    id: tokenRecord.user_id,
    uid: tokenRecord.user_id,
    iss: 'truxify-backend-api',
  },
  JWT_SECRET,
  { expiresIn: '7d' },
);

export const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken: token, deviceId, deviceInfo } = req.body;

    if (!token || !deviceId) {
      return next(new ValidationError('Refresh token and deviceId are required'));
    }

    const newTokenData = await refreshTokenService.rotateRefreshToken(token, deviceId, deviceInfo);
    const newAccessToken = createAccessToken(newTokenData);

    return res.status(200).json({
      success: true,
      accessToken: newAccessToken,
      refreshToken: newTokenData.token,
      expiresAt: newTokenData.expires_at,
    });
  } catch (err) {
    if (err.message.includes('Token reuse detected')) {
      return next(new UnauthorizedError('Security Alert: Token theft detected. All sessions terminated.'));
    }
    return next(new UnauthorizedError(err.message));
  }
};

export const logout = async (req, res, next) => {
  try {
    const { refreshToken: token } = req.body;
    if (token) {
      await refreshTokenService.revokeToken(token);
    }
    return res.status(200).json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    return next(new AppError(err.message, 500));
  }
};

export const logoutAllDevices = async (req, res, next) => {
  try {
    const userId = req.user.uid;
    await refreshTokenService.revokeAllUserTokens(userId);
    return res.status(200).json({ success: true, message: 'Logged out from all devices' });
  } catch (err) {
    return next(new AppError(err.message, 500));
  }
};

const authController = {
  refreshToken,
  logout,
  logoutAllDevices,
};

export default authController;
