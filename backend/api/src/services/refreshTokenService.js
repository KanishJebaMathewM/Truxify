import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'placeholder-key';
export const supabase = createClient(supabaseUrl, supabaseKey);

export const REFRESH_TOKEN_EXPIRY_DAYS = 30;

export const generateRefreshToken = () => {
  return crypto.randomBytes(40).toString('hex');
};

export const revokeToken = async (token) => {
  await supabase
    .from('refresh_tokens')
    .update({ is_revoked: true, revoked_at: new Date().toISOString() })
    .eq('token', token);
};

export const revokeAllUserTokens = async (userId) => {
  await supabase
    .from('refresh_tokens')
    .update({ is_revoked: true, revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('is_revoked', false);
};

export const createRefreshToken = async (userId, deviceId, deviceInfo) => {
  const token = generateRefreshToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

  const { data, error } = await supabase
    .from('refresh_tokens')
    .insert({
      user_id: userId,
      token: token,
      device_id: deviceId,
      device_info: deviceInfo,
      expires_at: expiresAt.toISOString(),
      is_revoked: false,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error('Failed to create refresh token', { cause: error });
  return data;
};

export const rotateRefreshToken = async (oldToken, deviceId, deviceInfo) => {
  const { data: tokenRecord, error } = await supabase
    .from('refresh_tokens')
    .select('*')
    .eq('token', oldToken)
    .single();

  if (error || !tokenRecord) {
    throw new Error('Invalid or expired refresh token');
  }

  if (tokenRecord.is_revoked) {
    await revokeAllUserTokens(tokenRecord.user_id);
    throw new Error('Token reuse detected. All sessions revoked.');
  }

  if (new Date(tokenRecord.expires_at) < new Date()) {
    await revokeToken(oldToken);
    throw new Error('Refresh token expired');
  }

  await revokeToken(oldToken);
  const newTokenData = await createRefreshToken(tokenRecord.user_id, deviceId, deviceInfo);
  return newTokenData;
};

const refreshTokenService = {
  createRefreshToken,
  rotateRefreshToken,
  revokeToken,
  revokeAllUserTokens,
};

export default refreshTokenService;
