import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const indexSource = fs.readFileSync(path.resolve(__dirname, '../../src/index.js'), 'utf8');

describe('voice assistant route mount', () => {
  it('mounts the driver voice assistant endpoint at the documented API v1 path', () => {
    expect(indexSource).toContain("import voiceAssistantRoutes from './routes/voice.routes.js'");
    expect(indexSource).toContain("app.use('/api/v1/voice', voiceAssistantRoutes)");
  });
});
