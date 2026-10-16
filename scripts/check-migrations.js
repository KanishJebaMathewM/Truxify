// scripts/check-migrations.js
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));

const hashes = new Map();
let hasDuplicates = false;

for (const file of files) {
  const filePath = path.join(migrationsDir, file);
  const content = fs.readFileSync(filePath, 'utf8');
  const hash = crypto.createHash('sha256').update(content).digest('hex');

  if (hashes.has(hash)) {
    console.error(`[ERROR] Duplicate migration content detected!\n  File 1: ${hashes.get(hash)}\n  File 2: ${file}`);
    hasDuplicates = true;
  } else {
    hashes.set(hash, file);
  }
}

if (hasDuplicates) {
  process.exit(1);
} else {
  console.log('[SUCCESS] All migration files are unique.');
}
