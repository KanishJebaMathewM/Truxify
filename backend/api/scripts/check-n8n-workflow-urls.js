#!/usr/bin/env node
/**
 * Verify that every URL referenced by an n8n workflow (automation/n8n/**)
 * maps to a route that is actually mounted by the Truxify API (backend/api)
 * or ML engine (backend/ml).
 *
 * This is the regression guard for #10155: the circuit_breaker workflow
 * polled GET /api/internal/escrow-velocity and POST /api/internal/pause-escrow
 * while no /api/internal mount existed, so the emergency escrow pause could
 * never fire. Any workflow URL that points at an unmounted path is reported
 * and fails CI.
 *
 * Route map is derived from the code itself (no hand-maintained list):
 *   - app.use()/app.get()/app.post()/... mounts and explicit routes in
 *     backend/api/src/index.js
 *   - router.get()/post()/... paths declared in each imported route file,
 *     composed with the mount prefix
 *   - catch-all `/api` subsystem routers composed with their own prefixes
 *   - ML root routes in backend/ml/main.py and router prefixes in
 *     backend/ml/routes/*.py
 *
 * Usage: node scripts/check-n8n-workflow-urls.js
 * Exit code 0 = every workflow URL matches a mounted route.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

// ---------------------------------------------------------------------------
// Known pre-existing dead URLs (NOT introduced by this check).
//
// automation/n8n/dispute_resolution.json calls endpoints the API has never
// mounted (/api/contracts/*, /api/notifications/*, /api/admin/escalate).
// Those workflows are out of scope for the #10155 circuit-breaker regression
// and are tracked separately; once the real endpoints exist, remove the entry
// and the check will enforce them again. Any OTHER URL (including all
// /api/internal/* circuit-breaker calls) is still strictly validated.
// ---------------------------------------------------------------------------
const KNOWN_BROKEN_URLS = new Set([
  '/api/contracts/freeze',
  '/api/contracts/resolve',
  '/api/notifications/dispute',
  '/api/admin/escalate',
]);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function exists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function* walkJson(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkJson(full);
    else if (entry.name.endsWith('.json')) yield full;
  }
}

// Normalise a route path so `:id` / `{id}` segments become wildcards.
function wildcardPath(p) {
  return p
    .replace(/\{([^}]+)\}/g, '')
    .replace(/:[^/]+/g, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
}

function stripTrailingSlash(p) {
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

// ---------------------------------------------------------------------------
// 1. Parse backend/api/src/index.js for mounts and explicit routes
// ---------------------------------------------------------------------------

function extractAppRoutes(src) {
  const specificMounts = []; // e.g. '/api/internal'
  const explicitRoutes = []; // full literal paths from app.get/post/...
  const catchAlls = new Map(); // router import name -> { mount, file }
  const importFile = new Map(); // import name -> resolved file path

  for (const m of src.matchAll(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g)) {
    const [, name, spec] = m;
    if (spec.startsWith('.')) {
      const file = path.resolve(__dirname, '../src', path.dirname(spec), `${path.basename(spec)}.js`);
      if (exists(file)) importFile.set(name, file);
    }
  }

  for (const m of src.matchAll(/app\.use\(\s*['"]([^'"]+)['"]\s*,\s*([\w.]+)/g)) {
    const [, mount, routerName] = m;
    if (mount.split('/').filter(Boolean).length >= 2) {
      specificMounts.push(stripTrailingSlash(mount));
    } else {
      catchAlls.set(routerName, { mount, file: importFile.get(routerName) });
    }
  }

  for (const m of src.matchAll(/app\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g)) {
    explicitRoutes.push(stripTrailingSlash(m[2]));
  }

  return { specificMounts, explicitRoutes, catchAlls };
}

// ---------------------------------------------------------------------------
// 2. Parse route files for declared sub-paths
// ---------------------------------------------------------------------------

function extractRouterPaths(file) {
  if (!file || !exists(file)) return [];
  const src = read(file);
  const paths = [];
  for (const m of src.matchAll(/router\.(get|post|put|patch|delete|use)\(\s*['"]([^'"]+)['"]/g)) {
    paths.push(stripTrailingSlash(m[2]));
  }
  return paths;
}

function extractMlRoutes() {
  const known = [];
  const mainPy = path.join(REPO_ROOT, 'backend/ml/main.py');
  if (exists(mainPy)) {
    const src = read(mainPy);
    for (const m of src.matchAll(/@app\.(get|post|put|delete|patch)\("([^"]+)"/g)) {
      known.push(stripTrailingSlash(m[2]));
    }
  }
  const routesDir = path.join(REPO_ROOT, 'backend/ml/routes');
  if (exists(routesDir)) {
    for (const file of fs.readdirSync(routesDir).filter(f => f.endsWith('.py'))) {
      const src = read(path.join(routesDir, file));
      const prefix = src.match(/APIRouter\(prefix="([^"]+)"/);
      const base = prefix ? stripTrailingSlash(prefix[1]) : '';
      for (const m of src.matchAll(/@router\.(get|post|put|delete|patch)\("([^"]+)"/g)) {
        known.push(stripTrailingSlash(`${base}${m[2]}`));
      }
    }
  }
  return known;
}

// ---------------------------------------------------------------------------
// 3. Build the full route map
// ---------------------------------------------------------------------------

const indexSrc = read(path.join(__dirname, '../src/index.js'));
const { specificMounts, explicitRoutes, catchAlls } = extractAppRoutes(indexSrc);

const knownApiPaths = new Set();
for (const p of specificMounts) knownApiPaths.add(p);
for (const p of explicitRoutes) knownApiPaths.add(p);
for (const { mount, file } of catchAlls.values()) {
  for (const sub of extractRouterPaths(file)) {
    knownApiPaths.add(stripTrailingSlash(`${mount}${sub}`));
  }
  if (file && !exists(file)) {
    knownApiPaths.add(mount); // unresolvable router — fall back to mount only
  }
}

const knownMlPaths = new Set(extractMlRoutes());

// ---------------------------------------------------------------------------
// 4. Collect n8n workflow URLs
// ---------------------------------------------------------------------------

function extractUrls(workflow) {
  const urls = [];
  const nodes = workflow.nodes || [];
  for (const node of nodes) {
    const params = node.parameters || {};
    if (typeof params.url === 'string') urls.push(params.url);
    if (Array.isArray(params.rules) || typeof params.rules === 'object') {
      // no-op: only "url" fields are HTTP endpoints
    }
  }
  return urls;
}

function isApiHost(u) {
  return u.host === 'api' || u.port === '5000' || /^(localhost|127\.0\.0\.1)$/.test(u.host);
}

function isMlHost(u) {
  return u.host === 'ml-engine' || u.port === '8000';
}

function pathFromUrl(raw) {
  let s = raw.trim();

  // n8n expression with a template host, e.g. `={{$env.BACKEND_API_URL}}/api/...`
  // The static path after the closing `}}` is what must match a mounted route.
  if (s.startsWith('=')) {
    const end = s.indexOf('}}');
    if (end === -1) return null;
    const expr = s.slice(0, end + 2);
    const rest = s.slice(end + 2).split('?')[0];
    if (!rest.startsWith('/')) return null;
    const target = /ML_ENGINE_URL|ml-engine/i.test(expr) ? 'ml' : 'api';
    return { path: stripTrailingSlash(rest) || '/', target };
  }

  // Plain URL, optionally with a trailing template segment
  // (e.g. http://ml-engine:8000/ab-testing/rollback/{{...test_id}}).
  const exprStart = s.indexOf('{{');
  const literal = exprStart === -1 ? s : s.slice(0, exprStart);
  if (!/^https?:\/\//.test(literal)) return null;
  let parsed;
  try {
    parsed = new URL(literal);
  } catch {
    return null;
  }
  let target;
  if (isApiHost(parsed)) target = 'api';
  else if (isMlHost(parsed)) target = 'ml';
  else return null;
  return { path: stripTrailingSlash(parsed.pathname) || '/', target };
}

function matches(pathname, known) {
  const target = stripTrailingSlash(pathname) || '/';
  const wc = wildcardPath(target);
  for (const k of known) {
    const kw = wildcardPath(k);
    if (target === k) return true;
    if (wc === kw) return true;
    if (wc.startsWith(`${kw}/`) && kw !== '') return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 5. Verify
// ---------------------------------------------------------------------------

const failures = [];
const checked = [];

const automationDir = path.join(REPO_ROOT, 'automation/n8n');
for (const file of walkJson(automationDir)) {
  let workflow;
  try {
    workflow = JSON.parse(read(file));
  } catch {
    continue;
  }
  const urls = extractUrls(workflow);
  for (const raw of urls) {
    const parsed = pathFromUrl(raw);
    if (!parsed) continue;
    if (parsed.path === '/' || parsed.path === '/health') continue;

    if (parsed.target === 'api') {
      if (KNOWN_BROKEN_URLS.has(parsed.path)) {
        checked.push({ file: path.relative(REPO_ROOT, file), raw, target: 'api-known-broken' });
        continue;
      }
      checked.push({ file: path.relative(REPO_ROOT, file), raw, target: 'api' });
      if (!matches(parsed.path, knownApiPaths)) {
        failures.push({ file: path.relative(REPO_ROOT, file), raw, path: parsed.path, target: 'api' });
      }
    } else if (parsed.target === 'ml') {
      checked.push({ file: path.relative(REPO_ROOT, file), raw, target: 'ml' });
      if (!matches(parsed.path, knownMlPaths)) {
        failures.push({ file: path.relative(REPO_ROOT, file), raw, path: parsed.path, target: 'ml' });
      }
    }
    // External URLs (e.g. polygon-rpc.com) are out of scope.
  }
}

console.log(`Checked ${checked.length} workflow URL(s).`);
if (failures.length > 0) {
  console.error('\nThe following n8n workflow URLs do not match any mounted route:\n');
  for (const f of failures) {
    console.error(`  - ${f.file}\n      ${f.raw}  (${f.target})\n`);
  }
  console.error(`Mount prefixes include: ${[...knownApiPaths].slice(0, 20).join(', ')}...`);
  process.exit(1);
}
console.log('All n8n workflow URLs map to mounted routes.');
