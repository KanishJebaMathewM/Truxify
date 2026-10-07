import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('index.js structure', () => {
  const indexPath = path.resolve(process.cwd(), 'src/index.js');
  // The express assembly lives in src/app.js; index.js is startup-only.
  const appPath = path.resolve(process.cwd(), 'src/app.js');

  it('is a JavaScript module with imports and exports', () => {
    const content = fs.readFileSync(indexPath, 'utf-8');
    expect(content).toContain('import');
    expect(content).toMatch(/export|default/);
  });

  it('imports Express', () => {
    const content = fs.readFileSync(appPath, 'utf-8');
    expect(content).toContain("import express from 'express'");
  });

  it('imports key middleware', () => {
    const content = fs.readFileSync(appPath, 'utf-8');
    expect(content).toContain('helmet');
    expect(content).toContain('cors');
  });

  it('imports route modules', () => {
    const content = fs.readFileSync(appPath, 'utf-8');
    expect(content).toContain('orderRoutes');
    expect(content).toContain('driverRoutes');
    expect(content).toContain('healthRoutes');
  });

  it('imports database configuration', () => {
    const content = fs.readFileSync(indexPath, 'utf-8');
    expect(content).toContain('config/db');
  });

  it('loads dotenv configuration', () => {
    const content = fs.readFileSync(appPath, 'utf-8');
    expect(content).toContain('dotenv.config');
  });

  it('imports WebSocket server modules', () => {
    const content = fs.readFileSync(indexPath, 'utf-8');
    expect(content).toContain('sockets/tracker');
    expect(content).toContain('initWebSocketServer');
  });

  it('imports escrow reconciliation workers', () => {
    const content = fs.readFileSync(indexPath, 'utf-8');
    expect(content).toContain('escrowReleaseReconciliation');
  });

  it('invokes waitForMongoDb and initWebSocketServer exactly once', () => {
    const content = fs.readFileSync(indexPath, 'utf-8');
    const waitForMongoDbMatches = content.match(/waitForMongoDb\(\)/g) || [];
    const initWebSocketServerMatches = content.match(/initWebSocketServer\(/g) || [];

    expect(waitForMongoDbMatches.length).toBe(1);
    // The import carries no '(' — exactly one call site.
    expect(initWebSocketServerMatches.length).toBe(1);
  });
});
