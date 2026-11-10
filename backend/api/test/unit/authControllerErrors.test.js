import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/refreshTokenService.js', () => ({
  default: {
    rotateRefreshToken: vi.fn(),
    revokeToken: vi.fn(),
    revokeAllUserTokens: vi.fn(),
  },
}));

const { default: refreshTokenService } = await import('../../src/services/refreshTokenService.js');
const { refreshToken, logout, logoutAllDevices } = await import(
  '../../src/controllers/authController.js'
);
const { AppError, UnauthorizedError, ValidationError } = await import('../../src/utils/errors.js');

function res() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
}

describe('authController error paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a refresh without token or deviceId with a ValidationError', async () => {
    const next = vi.fn();

    await refreshToken({ body: { deviceId: 'd1' } }, res(), next);

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0][0]).toBeInstanceOf(ValidationError);
    expect(next.mock.calls[0][0].statusCode).toBe(400);
    expect(refreshTokenService.rotateRefreshToken).not.toHaveBeenCalled();
  });

  it('turns a failed rotation into an UnauthorizedError', async () => {
    refreshTokenService.rotateRefreshToken.mockRejectedValue(new Error('Token reuse detected'));
    const next = vi.fn();

    await refreshToken({ body: { refreshToken: 't', deviceId: 'd1' } }, res(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(UnauthorizedError);
    expect(next.mock.calls[0][0].message).toMatch(/Token theft detected/);
  });

  it('issues a new access token on a successful rotation', async () => {
    refreshTokenService.rotateRefreshToken.mockResolvedValue({
      user_id: 'u1',
      token: 'new-refresh',
      expires_at: '2030-01-01T00:00:00.000Z',
    });
    const response = res();

    await refreshToken({ body: { refreshToken: 't', deviceId: 'd1' } }, response, vi.fn());

    expect(response.status).toHaveBeenCalledWith(200);
    const body = response.json.mock.calls[0][0];
    expect(body).toMatchObject({ success: true, refreshToken: 'new-refresh' });
    expect(typeof body.accessToken).toBe('string');
  });

  it('reports logout failures as AppError instead of crashing', async () => {
    refreshTokenService.revokeToken.mockRejectedValue(new Error('db down'));
    const next = vi.fn();

    await logout({ body: { refreshToken: 't' } }, res(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(AppError);
    expect(next.mock.calls[0][0].statusCode).toBe(500);
  });

  it('reports logout-all failures as AppError instead of crashing', async () => {
    refreshTokenService.revokeAllUserTokens.mockRejectedValue(new Error('db down'));
    const next = vi.fn();

    await logoutAllDevices({ user: { uid: 'u1' } }, res(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(AppError);
  });
});
