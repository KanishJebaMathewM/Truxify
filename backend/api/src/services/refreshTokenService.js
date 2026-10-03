import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import {
  generateFamilyId,
  registerTokenFamily,
  verifyAndRotateFamily,
  revokeTokenFamily,
  isFamilyRevoked,
} from '../security/tokenFamilyManager.js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'placeholder-key';
export const supabase = createClient(supabaseUrl, supabaseKey);

export const REFRESH_TOKEN_EXPIRY_DAYS = 30;

export const generateRefreshToken = () => {
  return crypto.randomBytes(40).toString('hex');
};

export const hashRefreshToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

export const revokeToken = async (token) => {
  await supabase
    .from('refresh_tokens')
    .update({ is_revoked: true, revoked_at: new Date().toISOString() })
    .eq('token_hash', hashRefreshToken(token));
};

export const revokeAllUserTokens = async (userId) => {
  await supabase
    .from('refresh_tokens')
    .update({ is_revoked: true, revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('is_revoked', false);
};

export const createRefreshToken = async (userId, deviceId, deviceInfo, familyId = null, generation = 0) => {
  const token = generateRefreshToken();
  const tokenHash = hashRefreshToken(token);
  const activeFamilyId = familyId || generateFamilyId();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

  registerTokenFamily(activeFamilyId, generation);

  const { data, error } = await supabase
    .from('refresh_tokens')
    .insert({
      user_id: userId,
      token_hash: tokenHash,
      device_id: deviceId,
      device_info: deviceInfo,
      family_id: activeFamilyId,
      generation: generation,
      expires_at: expiresAt.toISOString(),
      is_revoked: false,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error('Failed to create refresh token', { cause: error });
  return { ...data, token, familyId: activeFamilyId, generation };
};

export const rotateRefreshToken = async (oldToken, deviceId, deviceInfo) => {
  const { data: tokenRecord, error } = await supabase
    .from('refresh_tokens')
    .select('*')
    .eq('token_hash', hashRefreshToken(oldToken))
    .single();

  if (error || !tokenRecord) {
    throw new Error('Invalid or expired refresh token');
  }

  const currentFamilyId = tokenRecord.family_id;
  const currentGen = tokenRecord.generation ?? 0;

  if (tokenRecord.is_revoked || (currentFamilyId && isFamilyRevoked(currentFamilyId))) {
    if (currentFamilyId) {
      revokeTokenFamily(currentFamilyId, 'TOKEN_REUSE_DETECTED');
    }
    await revokeAllUserTokens(tokenRecord.user_id);
    throw new Error('Token reuse detected. All sessions revoked.');
  }

  const rotationCheck = verifyAndRotateFamily(currentFamilyId, currentGen);
  if (!rotationCheck.valid) {
    await revokeAllUserTokens(tokenRecord.user_id);
    throw new Error('Token reuse detected. All sessions revoked.');
  }

  if (new Date(tokenRecord.expires_at) < new Date()) {
    await revokeToken(oldToken);
    throw new Error('Refresh token expired');
  }

  await revokeToken(oldToken);
  const nextGen = rotationCheck.nextGen ?? (currentGen + 1);
  const newTokenData = await createRefreshToken(
    tokenRecord.user_id,
    deviceId,
    deviceInfo,
    currentFamilyId,
    nextGen
  );
  return newTokenData;
};

const refreshTokenService = {
  createRefreshToken,
  rotateRefreshToken,
  revokeToken,
  revokeAllUserTokens,
};

export default refreshTokenService;

