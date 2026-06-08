#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

const REQUIRED_RPC_FUNCTIONS = [
  'accept_bid_tx',
  'withdraw_funds_tx',
  'complete_trip_tx',
  'submit_rating_tx',
];

const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
};

const icon = {
  ok: `${colors.green}✔${colors.reset}`,
  warn: `${colors.yellow}⚠${colors.reset}`,
  fail: `${colors.red}✖${colors.reset}`,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(apiRoot, '..', '..');

dotenv.config({ path: path.join(apiRoot, '.env'), quiet: true });

function printHeading(text) {
  console.log(`\n${colors.bold}${colors.cyan}${text}${colors.reset}`);
}

function parseArgs(argv) {
  const args = {
    schemaPath: path.join(repoRoot, 'docs', 'schema.md'),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--schema' && argv[index + 1]) {
      args.schemaPath = path.resolve(process.cwd(), argv[index + 1]);
      index += 1;
    }
  }

  return args;
}

async function readRequiredTables(schemaPath) {
  const schema = await fs.readFile(schemaPath, 'utf8');
  const tables = [];
  let inErDiagram = false;

  for (const line of schema.split('\n')) {
    if (line.trim() === 'erDiagram') {
      inErDiagram = true;
      continue;
    }

    if (inErDiagram && line.trim() === '```') {
      break;
    }

    const tableMatch = line.match(/^\s{4}([a-z][a-z0-9_]*)\s+\{\s*$/);
    if (inErDiagram && tableMatch) {
      tables.push(tableMatch[1]);
    }
  }

  return [...new Set(tables)];
}

function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  const missing = [];
  if (!supabaseUrl) missing.push('SUPABASE_URL');
  if (!supabaseKey) missing.push('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY');

  return { supabaseUrl, supabaseKey, missing };
}

async function fetchOpenApiSpec(supabaseUrl, supabaseKey) {
  const response = await fetch(`${supabaseUrl}/rest/v1/`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Accept: 'application/openapi+json, application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`OpenAPI request failed with ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function verifyFromOpenApi(openApiSpec, requiredTables, requiredFunctions) {
  const paths = openApiSpec?.paths ?? {};

  return {
    tables: requiredTables.map((table) => ({
      name: table,
      ok: Boolean(paths[`/${table}`]),
    })),
    functions: requiredFunctions.map((fn) => ({
      name: fn,
      ok: Boolean(paths[`/rpc/${fn}`]),
    })),
  };
}

async function probeTablesWithSupabase(supabaseUrl, supabaseKey, requiredTables) {
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const results = [];
  for (const table of requiredTables) {
    try {
      const { error } = await supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
        .limit(0);

      results.push({
        name: table,
        ok: !error,
        detail: error?.message,
      });
    } catch (error) {
      results.push({
        name: table,
        ok: false,
        detail: error.message,
      });
    }
  }

  return results;
}

function printResults(title, results) {
  printHeading(title);
  for (const result of results) {
    const statusIcon = result.ok ? icon.ok : icon.fail;
    const detail = result.detail ? ` — ${result.detail}` : '';
    console.log(`${statusIcon} ${result.name}${detail}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { supabaseUrl, supabaseKey, missing } = getSupabaseConfig();

  printHeading('Truxify Database Schema Verification');

  let requiredTables;
  try {
    requiredTables = await readRequiredTables(args.schemaPath);
  } catch (error) {
    console.error(`${icon.fail} Unable to read schema definitions: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (requiredTables.length === 0) {
    console.error(`${icon.fail} No tables were found in ${args.schemaPath}`);
    process.exitCode = 1;
    return;
  }

  if (missing.length > 0) {
    console.error(`${icon.fail} Missing required environment variables: ${missing.join(', ')}`);
    console.log(`${icon.warn} Add them to backend/api/.env or export them before running this script.`);
    process.exitCode = 1;
    return;
  }

  let tableResults = [];
  let functionResults = [];
  let usedFallback = false;

  try {
    await fetchOpenApiSpec(supabaseUrl, supabaseKey).then((spec) => {
      const results = verifyFromOpenApi(spec, requiredTables, REQUIRED_RPC_FUNCTIONS);
      tableResults = results.tables;
      functionResults = results.functions;
    });
    console.log(`${icon.ok} Database connection successful`);
  } catch (error) {
    usedFallback = true;
    console.log(`${icon.warn} OpenAPI schema inspection unavailable: ${error.message}`);
    console.log(`${icon.warn} Falling back to table probes. RPC verification requires REST schema access.`);
    tableResults = await probeTablesWithSupabase(supabaseUrl, supabaseKey, requiredTables);
    functionResults = REQUIRED_RPC_FUNCTIONS.map((name) => ({
      name,
      ok: false,
      detail: 'not checked because OpenAPI schema was unavailable',
    }));
  }

  printResults('Table Verification', tableResults);
  printResults('RPC Verification', functionResults);

  const missingTables = tableResults.filter((result) => !result.ok);
  const missingFunctions = functionResults.filter((result) => !result.ok);

  printHeading('Schema Verification Summary');
  console.log(`Tables Checked: ${tableResults.length}`);
  console.log(`Missing Tables: ${missingTables.length}`);
  console.log(`Functions Checked: ${functionResults.length}`);
  console.log(`Missing Functions: ${missingFunctions.length}`);

  if (missingTables.length > 0 || missingFunctions.length > 0) {
    console.log(`\n${icon.warn} Validation completed with warnings.`);
    process.exitCode = usedFallback && missingTables.length === 0 ? 2 : 1;
    return;
  }

  console.log(`\n${icon.ok} Validation completed successfully.`);
}

main().catch((error) => {
  console.error(`${icon.fail} Unexpected verification failure: ${error.message}`);
  process.exitCode = 1;
});
