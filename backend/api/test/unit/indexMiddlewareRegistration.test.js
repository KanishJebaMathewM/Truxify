import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Regression guard for the `app.use('/api', verifyJWT)` registration that used
 * to sit at the top of the RATE LIMITING block in `src/index.js`.
 *
 * `index.js` imported `verifyJWT` from `middleware/auth.js`, but a later merge
 * dropped that export. The import therefore resolved to `undefined`, and
 * Express 5 rejects a non-function handler:
 *
 *   TypeError: argument handler must be a function
 *
 * That is thrown while the module is being evaluated, so the server never
 * finished booting and never listened.
 *
 * `index.js` is read as source rather than imported: importing it for real
 * opens database handles, starts background workers, and installs signal
 * handlers, none of which is acceptable in a unit test.
 */

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const indexSource = fs.readFileSync(path.join(API_DIR, 'src/index.js'), 'utf8');
const authSource = fs.readFileSync(path.join(API_DIR, 'src/middleware/auth.js'), 'utf8');

/**
 * Strips comments so assertions only ever look at executable code. The fix for
 * this bug documents the removed line in a comment, and that comment must not
 * be mistaken for a live registration.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

const indexCode = stripComments(indexSource);

/** Named imports of middleware/auth.js that index.js performs. */
function authImports() {
  return [
    ...indexCode.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"][^'"]*middleware\/auth\.js['"]/g),
  ].flatMap(([, names]) => names.split(',').map((n) => n.trim()).filter(Boolean));
}

/** Top-level `export function|const|let|var` names in middleware/auth.js. */
function authExports() {
  return new Set(
    [...stripComments(authSource).matchAll(/export\s+(?:async\s+)?(?:function|const|let|var)\s+(\w+)/g)].map(
      ([, name]) => name
    )
  );
}

describe('src/index.js imports from middleware/auth.js', () => {
  it('never imports verifyJWT, which has no export in middleware/auth.js', () => {
    expect(indexCode).not.toMatch(/\bverifyJWT\b/);
  });

  it('imports only symbols that middleware/auth.js actually exports', () => {
    const exported = authExports();

    // A named import that resolves to undefined is silently a no-op in many
    // places and a hard crash in others; this catches it at the source level.
    for (const name of authImports()) {
      expect(exported, `index.js imports "${name}" from middleware/auth.js`).toContain(name);
    }
  });
});

describe('src/index.js middleware registration', () => {
  it('does not install a global authentication gate ahead of every /api route', () => {
    // Authentication is applied per mount. A blanket
    // `app.use('/api', <identifier>)` before the route mounts would also
    // capture /api/health, /api/auth and /api/public.
    const globalApiGates = [...indexCode.matchAll(/app\.use\(\s*['"`]\/api['"`]\s*,\s*(\w+)/g)].map(
      ([, handler]) => handler
    );

    expect(globalApiGates).not.toContain('verifyJWT');
  });

  it('mounts /api/health with no authentication middleware in front of it', () => {
    // Container health checks call it without credentials.
    expect(indexCode).toContain("app.use('/api/health', healthRoutes)");

    const healthIndex = indexCode.indexOf("app.use('/api/health', healthRoutes)");
    const before = indexCode.slice(0, healthIndex);

    const bareApiGate = /app\.use\(\s*['"`]\/api['"`]\s*,\s*(?!healthLimiter\b|globalLimiter\b|requestCacheMiddleware\b)\w+/;
    expect(before, 'an authentication gate is mounted before /api/health').not.toMatch(bareApiGate);
  });
});

describe('Express 5 rejects undefined handlers', () => {
  it('throws at registration, which is the failure this bug caused', () => {
    // Confirms the assumption the fix relies on. If a future Express upgrade
    // silently accepted undefined, the reasoning documented in src/index.js
    // would need revisiting.
     
    const express = require('express');
    expect(() => express().use('/api', undefined)).toThrow(/must be a function/i);
  });
});
