import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import PluginManager from '../PluginManager.js';

const makePlugin = (name, extra = {}) => ({
  name,
  version: '1.0.0',
  description: `${name} plugin`,
  author: 'test',
  category: 'widget',
  dependencies: [],
  hooks: {},
  lifecycle: {},
  registeredAt: Date.now(),
  isInitialized: false,
  isActive: false,
  async initialize() {
    if (this.lifecycle.init) await this.lifecycle.init(this);
    this.isInitialized = true; this.isActive = true; return this;
  },
  async destroy() {
    if (this.lifecycle.destroy) await this.lifecycle.destroy(this);
    this.isActive = false; this.isInitialized = false;
  },
  render(props) { return `rendered:${this.name}`; },
  ...extra,
});

describe('PluginManager registration', () => {
  test('registers a plugin and emits pluginRegistered', () => {
    const pm = new PluginManager();
    let evt = null;
    pm.on('pluginRegistered', (e) => (evt = e));
    assert.equal(pm.register(makePlugin('loads-board')), true);
    assert.deepEqual(evt, { name: 'loads-board', category: 'widget' });
    assert.ok(pm.plugins.has('loads-board'));
  });

  test('duplicate registration is refused', () => {
    const pm = new PluginManager();
    pm.register(makePlugin('dup'));
    assert.equal(pm.register(makePlugin('dup')), false);
  });

  test('missing dependency is refused; satisfied dependency registers', () => {
    const pm = new PluginManager();
    assert.equal(pm.register(makePlugin('child', { dependencies: ['parent'] })), false);
    pm.register(makePlugin('parent'));
    assert.equal(pm.register(makePlugin('child', { dependencies: ['parent'] })), true);
  });
});

describe('PluginManager hooks', () => {
  test('executeHook runs handlers in registration order and collects results', async () => {
    const pm = new PluginManager();
    pm.register(makePlugin('a', { hooks: { beforeRender: async (x) => x + 1 } }));
    pm.register(makePlugin('b', { hooks: { beforeRender: async (x) => x * 2 } }));
    const results = await pm.executeHook('beforeRender', 10);
    assert.deepEqual(results, [
      { plugin: 'a', result: 11 },
      { plugin: 'b', result: 20 },
    ]);
  });

  test('a throwing hook is isolated — other hooks still run and the error is captured', async () => {
    const pm = new PluginManager();
    pm.register(makePlugin('bad', { hooks: { h: async () => { throw new Error('boom'); } } }));
    pm.register(makePlugin('good', { hooks: { h: async () => 'fine' } }));
    const results = await pm.executeHook('h');
    assert.equal(results[0].plugin, 'bad');
    assert.equal(results[0].error, 'boom');
    assert.deepEqual(results[1], { plugin: 'good', result: 'fine' });
  });

  test('executeHook on an unknown hook returns an empty list', async () => {
    const pm = new PluginManager();
    assert.deepEqual(await pm.executeHook('nope'), []);
  });
});

describe('PluginManager lifecycle', () => {
  test('initializePlugin runs lifecycle.init and flips state flags', async () => {
    const pm = new PluginManager();
    let inited = false;
    pm.register(makePlugin('lp', { lifecycle: { init: async () => { inited = true; } } }));
    await pm.initializePlugin('lp');
    assert.equal(inited, true);
    assert.equal(pm.plugins.get('lp').isInitialized, true);
  });

  test('destroyPlugin runs lifecycle.destroy and clears flags', async () => {
    const pm = new PluginManager();
    let destroyed = false;
    pm.register(makePlugin('dp', { lifecycle: { destroy: async () => { destroyed = true; } } }));
    await pm.initializePlugin('dp');
    await pm.destroyPlugin('dp');
    assert.equal(destroyed, true);
    assert.equal(pm.plugins.get('dp').isActive, false);
  });

  test('initializeAll/destroyAll cover every registered plugin', async () => {
    const pm = new PluginManager();
    pm.register(makePlugin('p1'));
    pm.register(makePlugin('p2'));
    await pm.initializeAll();
    assert.ok(pm.plugins.get('p1').isInitialized && pm.plugins.get('p2').isInitialized);
    await pm.destroyAll();
    assert.ok(!pm.plugins.get('p1').isActive && !pm.plugins.get('p2').isActive);
  });
});
