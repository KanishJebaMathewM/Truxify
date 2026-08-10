const fs = require('fs');
const path = require('path');

const K8S_DIR = 'k8s';

function collectSecretKeys(file) {
  const content = fs.readFileSync(path.join(K8S_DIR, file), 'utf8');
  const secrets = new Map(); // secret name -> Set of data keys

  for (const doc of content.split(/^---\s*$/m)) {
    if (!doc.includes('kind: Secret')) continue;

    let name = null;
    const keys = new Set();
    let inData = false;

    for (const line of doc.split(/\r?\n/)) {
      if (line.trim() === 'data:' || /^data:\s*$/.test(line)) {
        inData = true;
        continue;
      }
      if (/^[^ \t]/.test(line) && inData && line.trim() !== '') {
        inData = false;
      }
      if (!inData) {
        const m = line.match(/^\s{2}name:\s*(\S+)/);
        if (m && name === null) name = m[1];
        continue;
      }
      const m = line.match(/^\s{2,}([A-Za-z0-9_.-]+)\s*:/);
      if (m) keys.add(m[1]);
    }

    if (name) secrets.set(name, keys);
  }

  return secrets;
}

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

const secrets = collectSecretKeys('secrets.yaml');
let failed = false;

for (const file of walkYamlFiles(K8S_DIR)) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith('#')) continue;
    if (!lines[i].includes('secretKeyRef:')) continue;

    const refIndent = lines[i].match(/^\s*/)[0].length;
    let name = null;
    let key = null;

    for (let j = i + 1; j < lines.length && lines[j].trim() !== ''; j++) {
      const indent = lines[j].match(/^\s*/)[0].length;
      if (indent <= refIndent) break;

      let m = lines[j].match(/^\s*name:\s*(\S+)/);
      if (m && name === null) name = m[1];
      m = lines[j].match(/^\s*key:\s*(\S+)/);
      if (m && key === null) key = m[1];

      if (name && key) break;
    }

    if (!name || !key) {
      console.error(`secretKeyRef without name/key resolved in ${file}:${i + 1}`);
      failed = true;
      continue;
    }

    if (!secrets.has(name)) {
      console.error(`Secret "${name}" referenced by ${file}:${i + 1} is not defined in k8s/secrets.yaml`);
      failed = true;
      continue;
    }

    if (!secrets.get(name).has(key)) {
      console.error(`Secret key "${key}" referenced by ${file}:${i + 1} is missing from Secret "${name}" (k8s/secrets.yaml)`);
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}
console.log('All secretKeyRef references resolve to keys defined in k8s/secrets.yaml.');
