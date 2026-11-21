
const fs = require("fs");
const path = require("path");

// Resolve manifest directory
const dir = path.resolve(
  __dirname,
  "..",
  "..",
  "k8s",
  "istio"
);

let failed = false;

// Report validation errors
function reportError(message) {
  console.error(`ERROR: ${message}`);
  failed = true;
}

// Check directory existence
if (!fs.existsSync(dir)) {
  reportError(`Manifest directory does not exist: ${dir}`);
} else {
  let files = [];

  try {
    files = fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry =>
        entry.isFile() && /\.(yaml|yml)$/i.test(entry.name)
      )
      .map(entry => entry.name)
      .sort();
  } catch (error) {
    reportError(`Unable to read directory: ${error.message}`);
  }

  if (!failed && files.length === 0) {
    reportError(`No YAML manifests found in ${dir}`);
  }

  // Validate each YAML file
  for (const file of files) {
    const full = path.join(dir, file);
    let content;

    try {
      content = fs.readFileSync(full, "utf8");
    } catch (error) {
      reportError(`Unable to read ${full}: ${error.message}`);
      continue;
    }

    // Check UTF-8 BOM
    if (content.charCodeAt(0) === 0xfeff) {
      reportError(`UTF-8 BOM detected in ${full}`);
    }

    const lines = content.split(/\r?\n/);

    // Check misplaced document separators
    lines.forEach((line, index) => {
      if (/\S---[ \t]*(?:#.*)?$/.test(line)) {
        reportError(
          `Misplaced document separator at ${full}:${index + 1}`
        );
      }
    });

    // Split YAML documents
    const documents = content
      .split(/^---[ \t]*(?:#.*)?$/m)
      .filter(doc => doc.trim().length > 0);

    // Check duplicate top-level keys
    documents.forEach((doc, documentIndex) => {
      const seen = new Set();

      for (const line of doc.split(/\r?\n/)) {
        const match = line.match(
          /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[A-Za-z_][A-Za-z0-9_-]*)[ \t]*:/
        );

        if (!match) continue;

        let key = match[1];

        // Normalize quoted keys
        if (key.startsWith('"')) {
          try {
            key = JSON.parse(key);
          } catch {
            continue;
          }
        } else if (key.startsWith("'")) {
          key = key.slice(1, -1).replace(/''/g, "'");
        }

        if (seen.has(key)) {
          reportError(
            `Duplicate top-level key "${key}" in document ${
              documentIndex + 1
            } of ${full}`
          );
        } else {
          seen.add(key);
        }
      }
    });
  }
}

// Final validation result
if (failed) {
  console.error("\nIstio manifest validation failed.");
  process.exitCode = 1;
} else {
  console.log(
    "All k8s/istio manifests look clean: " +
    "no BOM, no misplaced document separators, " +
    "and no duplicate top-level mapping keys."
  );
}

