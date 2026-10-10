import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import {
  generateFamilyId,
  revokeTokenFamily,
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
  const { error } = await supabase
    .from('refresh_tokens')
    .update({ is_revoked: true, revoked_at: new Date().toISOString() })
    .eq('token_hash', hashRefreshToken(token));
  if (error) throw new Error('Failed to revoke refresh token', { cause: error });
};

export const revokeAllUserTokens = async (userId) => {
  const { error } = await supabase
    .from('refresh_tokens')
    .update({ is_revoked: true, revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('is_revoked', false);
  if (error) throw new Error('Failed to revoke user refresh tokens', { cause: error });
};

export const createRefreshToken = async (userId, deviceId, deviceInfo, familyId = null, generation = 0) => {
  const token = generateRefreshToken();
  const tokenHash = hashRefreshToken(token);
  const activeFamilyId = familyId || generateFamilyId();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

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

// Atomically consumes a refresh token that is still live.
//
// This is ONE conditional statement: UPDATE ... WHERE token_hash = $1 AND
// is_revoked = false RETURNING token_hash. Postgres serializes concurrent writers on
// the row, so when N requests rotate the same token at once exactly one of them gets
// a row back and the rest get none. The database is the only arbiter shared by every
// API replica: a SELECT followed by an unconditional UPDATE (check-then-act), or the
// per-process maps in tokenFamilyManager, cannot provide that guarantee.
const consumeRefreshToken = async (token) => {
  const { data, error } = await supabase
    .from('refresh_tokens')
    .update({ is_revoked: true, revoked_at: new Date().toISOString() })
    .eq('token_hash', hashRefreshToken(token))
    .eq('is_revoked', false)
    .select('token_hash');
  if (error) throw new Error('Failed to revoke refresh token', { cause: error });
  return Array.isArray(data) && data.length > 0;
};

// A refresh token that was already consumed has been presented again: treat it as
// theft, terminate every session of the user and report the reuse.
const rejectReusedToken = async (tokenRecord) => {
  if (tokenRecord.family_id) {
    revokeTokenFamily(tokenRecord.family_id, 'TOKEN_REUSE_DETECTED');
  }
  await revokeAllUserTokens(tokenRecord.user_id);
  throw new Error('Token reuse detected. All sessions revoked.');
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

  if (tokenRecord.is_revoked) {
    return rejectReusedToken(tokenRecord);
  }

  const expiresAtMs = new Date(tokenRecord.expires_at).getTime();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    await revokeToken(oldToken);
    throw new Error('Refresh token expired');
  }

  // Mint the replacement BEFORE consuming the old token (and from the generation of
  // the row we read, never from process memory). The order matters for two reasons:
  //  1. A transient failure here no longer burns the user's still-valid token.
  //  2. It closes the revoke-all race. If the old token is reused concurrently, the
  //     loser sweeps every live token of the user (rejectReusedToken). Because the
  //     winner's replacement is committed before the winner's conditional UPDATE, and
  //     the loser only sweeps after that UPDATE has lost, the sweep always sees and
  //     revokes it. Consuming first would let a replacement inserted a moment later
  //     survive "all sessions revoked", possibly in the thief's hands.
  const replacement = await createRefreshToken(
    tokenRecord.user_id,
    deviceId,
    deviceInfo,
    tokenRecord.family_id,
    (tokenRecord.generation ?? 0) + 1
  );

  // The database decides the winner: only the request whose conditional UPDATE
  // actually flipped is_revoked may hand its replacement to the caller. A concurrent
  // request presenting the same token (same or another replica) gets zero rows back
  // and is handled as reuse instead of forking the token chain.
  let consumed;
  try {
    consumed = await consumeRefreshToken(oldToken);
  } catch (err) {
    // The replacement was never returned, so it is unreachable; revoke it anyway.
    await revokeToken(replacement.token).catch(() => {});
    throw err;
  }
  if (!consumed) {
    return rejectReusedToken(tokenRecord);
  }

  return replacement;
};

const refreshTokenService = {
  createRefreshToken,
  rotateRefreshToken,
  revokeToken,
  revokeAllUserTokens,
};

export default refreshTokenService;

