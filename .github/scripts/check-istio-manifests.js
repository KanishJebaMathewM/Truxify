const fs = require('fs');
const path = require('path');

const dir = 'k8s/istio';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));

let failed = false;

for (const file of files) {
  const full = path.join(dir, file);
  const content = fs.readFileSync(full, 'utf8');

  if (content.charCodeAt(0) === 0xfeff) {
    console.error(`UTF-8 BOM detected at the start of ${full}`);
    failed = true;
  }

  // A separator glued to the previous value (`minHealthPercent: 50---`) is not
  // a separator at all: YAML reads the dashes as part of the scalar and the
  // whole file collapses into one document, silently dropping every resource
  // after the first. Report it directly — the duplicate-key check below would
  // otherwise fire instead and point at the wrong cause.
  content.split(/\r?\n/).forEach((line, idx) => {
    if (/[^\s]---\s*$/.test(line)) {
      console.error(
        `Document separator "---" is not on its own line at ${full}:${idx + 1} — ` +
          `"${line.trim()}". Every resource after this point is lost.`
      );
      failed = true;
    }
  });

  const documents = content.split(/^---\s*$/m).filter((doc) => doc.trim().length > 0);

  documents.forEach((doc, i) => {
    const seen = new Set();
    for (const line of doc.split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:/);
      if (m) {
        if (seen.has(m[1])) {
          console.error(`Duplicate top-level mapping key "${m[1]}" in document ${i + 1} of ${full}`);
          failed = true;
        }
        seen.add(m[1]);
      }
    }
  });
}

if (failed) {
  process.exit(1);
}
console.log('All k8s/istio manifests look clean: no BOM, no duplicate top-level mapping keys.');
