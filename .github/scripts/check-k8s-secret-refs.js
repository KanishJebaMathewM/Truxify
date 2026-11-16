
const fs = require("fs");
const path = require("path");

const K8S_DIR = "k8s";
const SECRET_FILE = path.join(K8S_DIR, "secrets.enc.yaml");

let failed = false;
const errors = [];

/**
 * Print validation error.
 */
function reportError(message) {
  errors.push(message);
  failed = true;
  console.error(`❌ ${message}`);
}

/**
 * Read YAML file safely.
 */
function readYaml(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    reportError(`Cannot read ${file}: ${error.message}`);
    return "";
  }
}

/**
 * Collect Secret names and data keys.
 */
function collectSecretKeys(file) {
  const content = readYaml(file);
  const secrets = new Map();

  if (!content) return secrets;

  const documents = content.split(/^---\s*$/m);

  for (const doc of documents) {
    if (!/^\s*kind:\s*Secret\s*$/m.test(doc)) continue;

    const nameMatch = doc.match(
      /^\s{0,}metadata:\s*\n[\s\S]*?^\s{2}name:\s*["']?([^"'\s#]+)["']?/m
    );

    if (!nameMatch) {
      reportError(`Secret without a valid metadata.name in ${file}`);
      continue;
    }

    const name = nameMatch[1];
    const keys = new Set();

    const dataMatch = doc.match(
      /^\s{0,}data:\s*\n([\s\S]*?)(?=^\S|\s*$)/m
    );

    if (dataMatch) {
      for (const line of dataMatch[1].split(/\r?\n/)) {
        const match = line.match(
          /^\s{2,}([A-Za-z0-9_.-]+)\s*:/
        );

        if (match) keys.add(match[1]);
      }
    }

    if (secrets.has(name)) {
      reportError(`Duplicate Secret name "${name}" in ${file}`);
    } else {
      secrets.set(name, keys);
    }
  }

  return secrets;
}

/**
 * Recursively find YAML files.
 */
function walkYamlFiles(dir) {
  const files = [];

  if (!fs.existsSync(dir)) {
    reportError(`Directory not found: ${dir}`);
    return files;
  }

  for (const entry of fs.readdirSync(dir, {
    withFileTypes: true,
  })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isSymbolicLink()) continue;

    if (entry.isDirectory()) {
      files.push(...walkYamlFiles(fullPath));
    } else if (/\.(yaml|yml)$/i.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Extract secretKeyRef references.
 */
function collectSecretReferences(file) {
  const content = readYaml(file);
  const lines = content.split(/\r?\n/);
  const references = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith("#")) continue;

    if (!/^\s*secretKeyRef\s*:\s*(?:#.*)?$/.test(lines[i])) {
      continue;
    }

    const refIndent = lines[i].match(/^\s*/)[0].length;

    let name = null;
    let key = null;

    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];

      if (!line.trim() || line.trimStart().startsWith("#")) {
        continue;
      }

      const indent = line.match(/^\s*/)[0].length;

      if (indent <= refIndent) break;

      const nameMatch = line.match(
        /^\s*name:\s*["']?([^"'\s#]+)["']?/
      );

      const keyMatch = line.match(
        /^\s*key:\s*["']?([^"'\s#]+)["']?/
      );

      if (nameMatch) name = nameMatch[1];
      if (keyMatch) key = keyMatch[1];
    }

    references.push({
      file,
      line: i + 1,
      name,
      key,
    });
  }

  return references;
}

/**
 * Validate Secret references.
 */
function validateReferences(secrets, files) {
  let checked = 0;

  for (const file of files) {
    const references = collectSecretReferences(file);

    for (const ref of references) {
      checked++;

      if (!ref.name || !ref.key) {
        reportError(
          `Incomplete secretKeyRef in ${ref.file}:${ref.line}`
        );
        continue;
      }

      if (!secrets.has(ref.name)) {
        reportError(
          `Secret "${ref.name}" referenced in ${ref.file}:${ref.line} is not defined in ${SECRET_FILE}`
        );
        continue;
      }

      if (!secrets.get(ref.name).has(ref.key)) {
        reportError(
          `Key "${ref.key}" is missing from Secret "${ref.name}" (${ref.file}:${ref.line})`
        );
      }
    }
  }

  return checked;
}

/**
 * Main validation.
 */
function main() {
  console.log("\n🔍 Kubernetes Secret Validation\n");

  if (!fs.existsSync(SECRET_FILE)) {
    reportError(`Secret file not found: ${SECRET_FILE}`);
    process.exit(1);
  }

  const secrets = collectSecretKeys(SECRET_FILE);
  const files = walkYamlFiles(K8S_DIR);

  if (files.length === 0) {
    reportError("No YAML files found in Kubernetes directory.");
  }

  const checked = validateReferences(secrets, files);

  console.log("\n--------------------------------");
  console.log(`YAML files scanned: ${files.length}`);
  console.log(`Secrets defined: ${secrets.size}`);
  console.log(`References checked: ${checked}`);
  console.log(`Errors found: ${errors.length}`);
  console.log("--------------------------------\n");

  if (failed) {
    console.error("❌ Secret validation failed.");
    process.exit(1);
  }

  console.log(
    "✅ All secretKeyRef references resolve to defined Secret keys."
  );
}

main();
