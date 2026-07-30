import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");
const EXAMPLE_PATH = path.join(ROOT, ".env.example");

const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

const TICK  = c.green("✔");
const WARN  = c.yellow("⚠");
const CROSS = c.red("✖");

function parseEnvFile(filePath) {
  let raw;
  try { raw = fs.readFileSync(filePath, "utf8"); }
  catch { return null; }

  const entries = new Map();
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    if (!key) continue;
    let value = line.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    entries.set(key, value);
  }
  return entries;
}

function checkNodeVersion() {
  const version = process.version;
  const major = parseInt(version.slice(1).split(".")[0], 10);
  return { version, major, ok: major >= 18 };
}

function main() {
  console.log();
  console.log(c.bold("  Truxify — Environment Pre-flight Check"));
  console.log(c.dim("  ─────────────────────────────────────────"));
  console.log();

  let warnings = 0, errors = 0;

  // Node version
  const node = checkNodeVersion();
  if (node.ok) {
    console.log(`  ${TICK} Node.js version: ${node.version}`);
  } else {
    console.log(`  ${WARN} Node.js version: ${node.version} ${c.yellow("(requires >= 18.x)")}`);
    warnings++;
  }

  // .env.example
  const exampleVars = parseEnvFile(EXAMPLE_PATH);
  if (exampleVars === null) {
    console.log(`  ${CROSS} ${c.red(".env.example not found")} — cannot compare variables`);
    console.log(`      ${c.dim("Expected at: " + EXAMPLE_PATH)}`);
    errors++;
  } else {
    console.log(`  ${TICK} .env.example found  ${c.dim("(" + exampleVars.size + " variables)")}`);
  }

  // .env
  const envVars = parseEnvFile(ENV_PATH);
  if (envVars === null) {
    console.log(`  ${CROSS} ${c.red(".env file not found")}`);
    console.log(`      ${c.dim("Run: cp .env.example .env  then fill in your values")}`);
    errors++;
  } else {
    console.log(`  ${TICK} .env file found`);
  }

  // Variable comparison
  if (exampleVars !== null && envVars !== null) {
    const missing = [], empty = [], optional = new Set();
    for (const [key, val] of exampleVars) {
      if (val.startsWith("optional:")) optional.add(key);
      if (!envVars.has(key)) {
        if (optional.has(key)) continue;
        missing.push(key);
      } else if (envVars.get(key) === "") {
        if (optional.has(key)) continue;
        empty.push(key);
      }
    }

    console.log();

    if (missing.length === 0) {
      console.log(`  ${TICK} No missing required variables`);
    } else {
      console.log(`  ${WARN} ${c.yellow("Missing required variables:")}`);
      missing.forEach(k => console.log(`      ${c.red("-")} ${k}`));
      warnings++;
    }

    if (empty.length === 0) {
      console.log(`  ${TICK} No empty required variables`);
    } else {
      console.log(`  ${WARN} ${c.yellow("Empty required variables:")}`);
      empty.forEach(k => console.log(`      ${c.yellow("-")} ${k}`));
      warnings++;
    }

    const total = exampleVars.size;
    const configured = total - missing.length - empty.length;
    console.log(`  ${c.dim(`${configured}/${total} variables configured`)}`);
  }

  // Summary
  console.log();
  console.log(c.dim("  ─────────────────────────────────────────"));

  if (errors > 0) {
    console.log(`  ${CROSS} ${c.red(c.bold("Validation failed."))}`);
    console.log(`     Fix the ${c.red(errors + " error(s)")} above before starting.\n`);
    process.exit(1);
  } else if (warnings > 0) {
    console.log(`  ${WARN} ${c.yellow(c.bold("Validation completed with warnings."))}\n`);
    process.exit(0);
  } else {
    console.log(`  ${TICK} ${c.green(c.bold("All checks passed. You're good to go!"))}\n`);
    process.exit(0);
  }
}

main();