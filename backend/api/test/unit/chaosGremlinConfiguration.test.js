import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { post, log } = vi.hoisted(() => ({ post: vi.fn(), log: { info: vi.fn(), error: vi.fn() } }));
vi.mock('axios', () => ({ default: { post } }));
vi.mock('../../src/config/db.js', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../../src/middleware/logger.js', () => ({ default: log }));
import chaos from '../../../../k8s/chaos/chaos-service.js';
const originalKey = chaos.gremlinApiKey;
const originalTeam = chaos.teamId;
const methods = ['runPodKill', 'runNetworkLatency', 'runCpuStress', 'runMemoryStress', 'runServiceDisruption'];
beforeEach(() => {
  vi.clearAllMocks();
  chaos.gremlinApiKey = 'test-only-key';
  chaos.teamId = 'test-only-team';
  post.mockResolvedValue({ data: { id: 'test-experiment' } });
});
afterEach(() => { chaos.gremlinApiKey = originalKey; chaos.teamId = originalTeam; vi.restoreAllMocks(); });
describe('Gremlin experiment configuration gate', () => {
  it.each(methods)('%s rejects a missing API key without an HTTP call', async method => {
    chaos.gremlinApiKey = undefined;
    await expect(chaos[method]({})).rejects.toThrow('GREMLIN_API_KEY');
    expect(post).not.toHaveBeenCalled();
  });
  it.each(methods)('%s rejects a missing team ID without an HTTP call', async method => {
    chaos.teamId = undefined;
    await expect(chaos[method]({})).rejects.toThrow('GREMLIN_TEAM_ID');
    expect(post).not.toHaveBeenCalled();
  });
  it.each(['', '   ', '\t\n'])('rejects blank credentials %j without leaking the other credential', async blank => {
    chaos.gremlinApiKey = blank;
    chaos.teamId = 'sensitive-test-value';
    const error = await chaos.runPodKill({}).catch(value => value);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('GREMLIN_API_KEY');
    expect(error.message).not.toContain('sensitive-test-value');
    expect(post).not.toHaveBeenCalled();
  });
  it('fails orchestration before recording an experiment or changing history', async () => {
    chaos.teamId = '';
    const save = vi.spyOn(chaos, 'storeExperiment').mockResolvedValue();
    const score = vi.spyOn(chaos, 'updateResilienceScore').mockResolvedValue();
    const historyLength = chaos.experimentHistory.length;
    await expect(chaos.runExperiment('cpu-stress')).rejects.toThrow('GREMLIN_TEAM_ID');
    expect(post).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(score).not.toHaveBeenCalled();
    expect(chaos.experimentHistory).toHaveLength(historyLength);
  });
  it.each(methods)('%s preserves configured experiment dispatch', async method => {
    expect(await chaos[method]({})).toEqual({ id: 'test-experiment' });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][2].headers.Authorization).toBe('Bearer test-only-key');
  });
});
