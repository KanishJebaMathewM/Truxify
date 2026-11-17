
const fs = require('fs');
const path = require('path');

// Resolve the manifest directory relative to this script,
// so the check works regardless of the current working directory.
const dir = path.resolve(__dirname, '..', '..', 'k8s', 'istio');

let failed = false;

function reportError(message) {
  console.error(`ERROR: ${message}`);
  failed = true;
}

// Check whether the manifest directory exists.
if (!fs.existsSync(dir)) {
  reportError(`Manifest directory does not exist: ${dir}`);
} else {
  let files = [];

  try {
    files = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() && /\.(yaml|yml)$/i.test(entry.name)
      )
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    reportError(`Unable to read manifest directory: ${error.message}`);
  }

  if (!failed && files.length === 0) {
    reportError(`No YAML manifests found in ${dir}`);
  }

  for (const file of files) {
    const full = path.join(dir, file);
    let content;

    try {
      content = fs.readFileSync(full, 'utf8');
    } catch (error) {
      reportError(`Unable to read ${full}: ${error.message}`);
      continue;
    }

    // Check for UTF-8 BOM.
    if (content.charCodeAt(0) === 0xfeff) {
      reportError(`UTF-8 BOM detected at the start of ${full}`);
    }

    const lines = content.split(/\r?\n/);

    // Detect document separators incorrectly attached to values.
    lines.forEach((line, index) => {
      if (/\S---[ \t]*(?:#.*)?$/.test(line)) {
        reportError(
          `Document separator "---" is not on its own line ` +
          `at ${full}:${index + 1} — "${line.trim()}". ` +
          'Every resource after this point may be lost.'
        );
      }
    });

    // Split documents using valid YAML document separator lines.
    const documents = content
      .split(/^---[ \t]*(?:#.*)?$/m)
      .filter((doc) => doc.trim().length > 0);

    documents.forEach((doc, documentIndex) => {
      const seen = new Set();

      for (const line of doc.split(/\r?\n/)) {
        // Only inspect top-level mapping keys.
        // Supports plain, single-quoted and double-quoted keys.
        const match = line.match(
          /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[A-Za-z_][A-Za-z0-9_-]*)[ \t]*:/
        );

        if (!match) {
          continue;
        }

        let key = match[1];

        // Normalize quoted keys before checking for duplicates.
        if (key.startsWith('"')) {
          try {
            key = JSON.parse(key);
          } catch {
            // Leave malformed quoted keys unchanged.
          }
        } else if (key.startsWith("'")) {
          key = key.slice(1, -1).replace(/''/g, "'");
        }

        if (seen.has(key)) {
          reportError(
            `Duplicate top-level mapping key "${key}" ` +
            `in document ${documentIndex + 1} of ${full}`
          );
        } else {
          seen.add(key);
        }
      }
    });
  }
}

if (failed) {
  console.error('\nIstio manifest validation failed.');
  process.exitCode = 1;
} else {
  console.log(
    'All k8s/istio manifests look clean: ' +
    'no BOM, no misplaced document separators, ' +
    'and no duplicate top-level mapping keys.'
  );
}
