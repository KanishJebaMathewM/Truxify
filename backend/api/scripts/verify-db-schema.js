#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const REQUIRED_RPC_FUNCTIONS = [
  'accept_bid_tx',
  'withdraw_funds_tx',
  'complete_trip_tx',
  'submit_rating_tx',
  'cancel_order_tx',
  'release_escrow_tx',
  'refund_escrow_tx',
  'update_trip_status_tx',
];

const REQUIRED_INDEXES = [
  'profiles_role_idx',
  'orders_customer_idx',
  'orders_driver_idx',
  'trucks_owner_idx',
  'trips_driver_idx',
  'load_offers_status_idx',
];

const TABLE_CATEGORIES = {
  core: ['profiles', 'orders', 'trips', 'trucks'],
  marketplace: ['load_offers', 'bids', 'routes'],
  financial: ['wallet_transactions', 'escrow_transactions'],
  support: ['support_tickets', 'faqs', 'notifications'],
};

const icons = {
  pass: '✓',
  fail: '✖',
  warn: '!',
};

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
};

const colorize = (text, color, enabled = process.stdout.isTTY) => (
  enabled ? `${colors[color]}${text}${colors.reset}` : text
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(apiRoot, '..', '..');

export function parseRequiredTables(schemaMarkdown) {
  const tableNames = [];
  const seen = new Set();
  const tableDefinitionPattern = /^\s{4}([a-z][a-z0-9_]*)\s+\{\s*$/;

  for (const line of schemaMarkdown.split(/\r?\n/)) {
    const match = line.match(tableDefinitionPattern);
    if (!match) continue;

    const tableName = match[1];
    if (!seen.has(tableName)) {
      seen.add(tableName);
      tableNames.push(tableName);
    }
  }

  return tableNames;
}

export function parseOpenApiRpcFunctions(openApiDocument) {
  const paths = openApiDocument?.paths ?? {};
  return new Set(
    Object.keys(paths)
      .map((route) => route.match(/^\/rpc\/([^/]+)$/)?.[1])
      .filter(Boolean)
  );
}

export function buildSummary(tableResults, functionResults) {
  return {
    tablesChecked: tableResults.length,
    missingTables: tableResults.filter((result) => !result.ok).length,
    functionsChecked: functionResults.length,
    missingFunctions: functionResults.filter((result) => !result.ok).length,
  };
}

function statusLine(result, useColor) {
  if (result.ok) {
    return colorize(`${icons.pass} ${result.name}`, 'green', useColor);
  }

  const detail = result.message ? ` - ${result.message}` : '';
  return colorize(`${icons.fail} ${result.name}${detail}`, 'red', useColor);
}

function printSection(title, results, useColor) {
  console.log(`\n${colorize(title, 'bold', useColor)}`);
  for (const result of results) {
    console.log(statusLine(result, useColor));
  }
}

function printSummary(summary, useColor) {
  const hasWarnings = summary.missingTables > 0 || summary.missingFunctions > 0;

  console.log(`\n${colorize('Schema Verification Summary', 'bold', useColor)}\n`);
  console.log(`Tables Checked: ${summary.tablesChecked}`);
  console.log(`Missing Tables: ${summary.missingTables}`);
  console.log('');
  console.log(`Functions Checked: ${summary.functionsChecked}`);
  console.log(`Missing Functions: ${summary.missingFunctions}`);
  console.log('');

  if (hasWarnings) {
    console.log(colorize(`${icons.warn} Validation completed with warnings.`, 'yellow', useColor));
  } else {
    console.log(colorize(`${icons.pass} Validation completed successfully.`, 'green', useColor));
  }
}

function loadEnvironment() {
  dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });
  dotenv.config({ path: path.join(apiRoot, '.env'), quiet: true });
}

async function loadRequiredTables() {
  const schemaPath = process.env.TRUXIFY_SCHEMA_DOC
    ? path.resolve(process.env.TRUXIFY_SCHEMA_DOC)
    : path.join(repoRoot, 'docs', 'schema.md');

  const schemaMarkdown = await fs.readFile(schemaPath, 'utf8');
  const tables = parseRequiredTables(schemaMarkdown);

  if (tables.length === 0) {
    throw new Error(`No table definitions found in ${schemaPath}`);
  }

  return tables;
}

async function verifyTable(supabase, tableName) {
  try {
    const { error } = await supabase
      .from(tableName)
      .select('*', { count: 'exact', head: true })
      .limit(1);

    if (error) {
      return { name: tableName, ok: false, message: error.message };
    }

    return { name: tableName, ok: true };
  } catch (error) {
    return { name: tableName, ok: false, message: error.message };
  }
}

async function fetchOpenApiSpec(supabaseUrl, supabaseKey) {
  const endpoint = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/`;
  const response = await fetch(endpoint, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Accept: 'application/openapi+json',
    },
  });

  if (!response.ok) {
    throw new Error(`OpenAPI request failed with HTTP ${response.status}`);
  }

  return response.json();
}

async function verifyRpcFunctions(supabaseUrl, supabaseKey) {
  try {
    const openApiDocument = await fetchOpenApiSpec(supabaseUrl, supabaseKey);
    const availableFunctions = parseOpenApiRpcFunctions(openApiDocument);

    return REQUIRED_RPC_FUNCTIONS.map((name) => ({
      name,
      ok: availableFunctions.has(name),
      message: availableFunctions.has(name) ? undefined : 'function not found in PostgREST schema',
    }));
  } catch (error) {
    return REQUIRED_RPC_FUNCTIONS.map((name) => ({
      name,
      ok: false,
      message: `could not verify RPC metadata: ${error.message}`,
    }));
  }
}

async function main() {
  const useColor = process.stdout.isTTY && process.env.NO_COLOR == null;
  loadEnvironment();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error(colorize(`${icons.fail} Missing Supabase credentials.`, 'red', useColor));
    console.error('Set SUPABASE_URL and either SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY.');
    return 1;
  }

  let requiredTables;
  try {
    requiredTables = await loadRequiredTables();
  } catch (error) {
    console.error(colorize(`${icons.fail} Missing schema definitions.`, 'red', useColor));
    console.error(error.message);
    return 1;
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  console.log(colorize(`${icons.pass} Database connection configured`, 'green', useColor));

  const tableResults = [];
  for (const tableName of requiredTables) {
    tableResults.push(await verifyTable(supabase, tableName));
  }

  const functionResults = await verifyRpcFunctions(supabaseUrl, supabaseKey);

  printSection('Table Verification', tableResults, useColor);
  printSection('RPC Verification', functionResults, useColor);

  const summary = buildSummary(tableResults, functionResults);
  printSummary(summary, useColor);

  return summary.missingTables === 0 && summary.missingFunctions === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(`${icons.fail} Schema verification failed: ${error.message}`);
      process.exitCode = 1;
    });
}
