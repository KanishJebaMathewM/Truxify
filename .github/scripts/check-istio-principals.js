const fs = require('fs');
const path = require('path');

const K8S_DIR = 'k8s';

function walkYamlFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkYamlFiles(full));
    } else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) {
      out.push(full);
    }
  }
  return out;
}

function extractMeta(lines) {
  let kind = null;
  let name = null;
  let ns = null;
  let inMeta = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed === '---') continue;

    const m = /^kind:\s*(\S+)/.exec(trimmed);
    if (m) {
      kind = m[1];
      continue;
    }

    if (trimmed === 'metadata:') {
      inMeta = true;
      continue;
    }
    if (inMeta && !/^\s/.test(line)) {
      inMeta = false;
    }
    if (inMeta) {
      const mName = /^name:\s*(\S+)/.exec(trimmed);
      if (mName && name === null) name = mName[1];
      const mNs = /^namespace:\s*(\S+)/.exec(trimmed);
      if (mNs && ns === null) ns = mNs[1];
    }
  }

  return { kind, name, ns: ns || 'default' };
}

function splitDocs(lines) {
  const docs = [];
  let current = [];
  for (const line of lines) {
    if (line.trim() === '---') {
      docs.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  docs.push(current);
  return docs.filter(d => d.some(l => l.trim() !== ''));
}

const serviceAccounts = new Set(); // `${ns}/${name}`
const refs = []; // {file, line, ns, name, principal}

for (const file of walkYamlFiles(K8S_DIR)) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

  for (const doc of splitDocs(lines)) {
    const { kind, name, ns } = extractMeta(doc);

    if (kind === 'ServiceAccount' && name) {
      serviceAccounts.add(`${ns}/${name}`);
    }

    const docNs = ns;
    for (let i = 0; i < doc.length; i++) {
      const line = doc[i].trimStart();
      if (line.startsWith('#')) continue;

      const saRef = /^serviceAccountName:\s*(\S+)/.exec(line);
      if (saRef) {
        refs.push({ file, line: i + 1, ns: docNs, name: saRef[1] });
        continue;
      }

      const principal = /^-\s+cluster\.local\/ns\/([^/]+)\/sa\/(\S+)/.exec(line);
      if (principal) {
        refs.push({ file, line: i + 1, ns: principal[1], name: principal[2] });
      }
    }
  }
}

let failed = false;

for (const ref of refs) {
  if (!serviceAccounts.has(`${ref.ns}/${ref.name}`)) {
    console.error(
      `ServiceAccount "${ref.name}" (namespace "${ref.ns}") referenced by ${ref.file}:${ref.line} has no matching ServiceAccount manifest (expected kind: ServiceAccount with name "${ref.name}" in namespace "${ref.ns}")`
    );
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
console.log('All serviceAccountName usages and Istio principals reference ServiceAccounts defined in k8s manifests.');
