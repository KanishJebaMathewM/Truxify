const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const CANARY_VS = path.join(ROOT, 'k8s', 'istio', 'virtual-service.yaml');

function splitDocs(content) {
  return content.split(/^\s*---\s*$/m).filter(Boolean);
}

function extract(lines, regex) {
  for (const line of lines) {
    const m = regex.exec(line);
    if (m) return m[1];
  }
  return null;
}

function collectServiceNames(dir) {
  const names = new Set();
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else if (/\.(yaml|yml)$/.test(entry.name)) {
        const content = fs.readFileSync(p, 'utf8');
        for (const doc of splitDocs(content)) {
          const lines = doc.split(/\r?\n/);
          if (extract(lines, /^\s*kind:\s*(\S+)/) !== 'Service') continue;
          const name = extract(lines, /^\s*name:\s*(\S+)/);
          if (name) names.add(name);
        }
      }
    }
  };
  walk(dir);
  return names;
}

const vsContent = fs.readFileSync(CANARY_VS, 'utf8');
const vsLines = vsContent.split(/\r?\n/);

const docs = splitDocs(vsContent).map((doc) => doc.split(/\r?\n/));
const virtualServiceDocs = docs.filter((lines) => extract(lines, /^\s*kind:\s*(\S+)/) === 'VirtualService');
if (virtualServiceDocs.length !== 1) {
  console.error(`Expected exactly one VirtualService document in ${CANARY_VS}, found ${virtualServiceDocs.length}.`);
  process.exit(1);
}

const hosts = [];
vsLines.forEach((line, idx) => {
  const m = /^\s*host:\s*(\S+)/.exec(line);
  if (m) hosts.push({ host: m[1].replace(/["']/g, '').split('.')[0], line: idx + 1 });
});

const services = collectServiceNames(path.join(ROOT, 'k8s'));

const missing = [];
for (const { host, line } of hosts) {
  if (!services.has(host)) missing.push(`${host} (virtual-service.yaml:${line})`);
}

if (missing.length > 0) {
  console.error('Canary VirtualService destinations with no matching Service in k8s manifests:');
  for (const m of missing) console.error(`  - ${m}`);
  console.error('Add the missing Service (with the correct selector) or remove/redirect the destination.');
  process.exit(1);
}

console.log(`All ${hosts.length} canary VirtualService destinations resolve to Services defined in k8s manifests.`);
