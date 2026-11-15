
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const K8S_DIR = path.resolve('k8s');

const serviceAccounts = new Map();
const references = [];
const errors = [];

let filesScanned = 0;
let documentsScanned = 0;

// Recursively discover YAML files

function walkYamlFiles(dir) {
  const files = [];

  if (!fs.existsSync(dir)) {
    throw new Error(`Directory not found: ${dir}`);
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkYamlFiles(fullPath));
    } else if (
      entry.isFile() &&
      /\.(yaml|yml)$/i.test(entry.name)
    ) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

// Get line number from source offset

function getLine(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

// Extract namespace

function getNamespace(resource) {
  return resource?.metadata?.namespace || 'default';
}

// Register ServiceAccount definitions

function registerServiceAccount(resource, file, line) {

  if (
    resource.kind !== 'ServiceAccount' ||
    !resource.metadata?.name
  ) {
    return;
  }

  const name = resource.metadata.name;
  const namespace = getNamespace(resource);
  const key = `${namespace}/${name}`;

  if (serviceAccounts.has(key)) {
    const previous = serviceAccounts.get(key);

    errors.push(
      `Duplicate ServiceAccount "${key}" in ${file}:${line}. ` +
      `Already defined in ${previous.file}:${previous.line}`
    );

    return;
  }

  serviceAccounts.set(key, {
    name,
    namespace,
    file,
    line
  });
}

// Extract ServiceAccount and Istio references

function extractReferences(node, file, source, namespace) {

  if (!node) return;

  // YAML mapping

  if (YAML.isMap(node)) {

    for (const pair of node.items) {

      const key = pair.key?.value;
      const value = pair.value;

      if (key === 'serviceAccountName') {

        if (
          YAML.isScalar(value) &&
          typeof value.value === 'string' &&
          value.value.trim() !== ''
        ) {

          references.push({
            type: 'serviceAccountName',
            file,
            line: getLine(source, value.range?.[0] ?? 0),
            namespace,
            name: value.value
          });

        } else {

          errors.push(
            `Invalid serviceAccountName in ${file}:` +
            `${getLine(source, pair.key?.range?.[0] ?? 0)}`
          );
        }
      }

      extractReferences(value, file, source, namespace);
    }
  }

  // YAML sequence

  else if (YAML.isSeq(node)) {

    for (const item of node.items) {
      extractReferences(item, file, source, namespace);
    }
  }

  // Scalar: detect Istio principal

  else if (
    YAML.isScalar(node) &&
    typeof node.value === 'string'
  ) {

    const principal =
      /^cluster\.local\/ns\/([^/]+)\/sa\/([^/]+)$/.exec(node.value);

    if (principal) {

      references.push({
        type: 'istio-principal',
        file,
        line: getLine(source, node.range?.[0] ?? 0),
        namespace: principal[1],
        name: principal[2]
      });
    }
  }
}

// Process YAML file

function processYamlFile(file) {

  const source = fs.readFileSync(file, 'utf8');
  filesScanned++;

  const docs = YAML.parseAllDocuments(source, {
    uniqueKeys: true,
    version: '1.2'
  });

  for (const doc of docs) {

    documentsScanned++;

    if (doc.errors.length > 0) {

      for (const error of doc.errors) {
        errors.push(
          `YAML parsing error in ${file}: ${error.message}`
        );
      }

      continue;
    }

    const resource = doc.toJS();

    if (!resource || typeof resource !== 'object' ||
        Array.isArray(resource)) {
      continue;
    }

    const namespace = getNamespace(resource);

    const documentLine = getLine(
      source,
      doc.contents?.range?.[0] ?? 0
    );

    registerServiceAccount(
      resource,
      file,
      documentLine
    );

    extractReferences(
      doc.contents,
      file,
      source,
      namespace
    );
  }
}

// Validate collected references

function validateReferences() {

  for (const ref of references) {

    const key = `${ref.namespace}/${ref.name}`;

    if (!serviceAccounts.has(key)) {

      errors.push(
        `${ref.type} reference "${key}" has no matching ` +
        `ServiceAccount manifest at ${ref.file}:${ref.line}`
      );
    }
  }
}

// Main function

function main() {

  try {

    console.log('\nStarting Kubernetes ServiceAccount validation...\n');

    const files = walkYamlFiles(K8S_DIR);

    if (files.length === 0) {
      throw new Error('No YAML manifests found in k8s directory');
    }

    for (const file of files) {
      processYamlFile(file);
    }

    validateReferences();

    console.log('\n========== VALIDATION SUMMARY ==========');
    console.log(`Files scanned: ${filesScanned}`);
    console.log(`Documents scanned: ${documentsScanned}`);
    console.log(`ServiceAccounts found: ${serviceAccounts.size}`);
    console.log(`References checked: ${references.length}`);
    console.log(`Errors found: ${errors.length}`);
    console.log('========================================\n');

    if (errors.length > 0) {

      console.error('VALIDATION FAILED:\n');

      errors.forEach((error, index) => {
        console.error(`${index + 1}. ${error}`);
      });

      process.exitCode = 1;
      return;
    }

    console.log(
      'SUCCESS: All ServiceAccount references and Istio principals are valid.'
    );

  } catch (error) {

    console.error(`FATAL ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

main();
