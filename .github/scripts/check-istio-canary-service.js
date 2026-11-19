
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const K8S_DIR = path.join(ROOT, "k8s");
const CANARY_VS = path.join(
  K8S_DIR,
  "istio",
  "virtual-service.yaml"
);

// Split multiple YAML documents
function splitDocs(content) {
  return content
    .split(/^\s*---\s*$/m)
    .map(doc => doc.trim())
    .filter(Boolean);
}

// Get a top-level YAML value
function getScalar(lines, key) {
  const regex = new RegExp(`^${key}:\\s*(\\S+)\\s*$`);

  for (const line of lines) {
    const match = regex.exec(line);
    if (match) {
      return match[1].replace(/^["']|["']$/g, "");
    }
  }

  return null;
}

// Get metadata fields
function getMetadataField(lines, field) {
  let inMetadata = false;

  for (const line of lines) {
    if (/^metadata:\s*$/.test(line)) {
      inMetadata = true;
      continue;
    }

    if (inMetadata) {
      if (/^\S/.test(line)) {
        break;
      }

      const regex = new RegExp(
        `^\\s{2,}${field}:\\s*(\\S+)\\s*$`
      );

      const match = regex.exec(line);

      if (match) {
        return match[1].replace(/^["']|["']$/g, "");
      }
    }
  }

  return null;
}

function getKind(lines) {
  return getScalar(lines, "kind");
}

// Collect Kubernetes services
function collectServices(dir) {
  const services = new Map();

  function walk(currentDir) {
    if (!fs.existsSync(currentDir)) return;

    for (const entry of fs.readdirSync(currentDir, {
      withFileTypes: true
    })) {
      const filePath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        walk(filePath);
        continue;
      }

      if (!/\.ya?ml$/.test(entry.name)) continue;

      const content = fs.readFileSync(filePath, "utf8");

      for (const doc of splitDocs(content)) {
        const lines = doc.split(/\r?\n/);

        if (getKind(lines) !== "Service") continue;

        const name = getMetadataField(lines, "name");

        if (!name) {
          throw new Error(
            `Service manifest missing metadata.name: ${filePath}`
          );
        }

        const namespace =
          getMetadataField(lines, "namespace") || "default";

        services.set(`${namespace}/${name}`, true);
      }
    }
  }

  walk(dir);
  return services;
}

// Find VirtualService documents
function getVirtualServiceDocuments(content) {
  return splitDocs(content)
    .map(doc => doc.split(/\r?\n/))
    .filter(lines => getKind(lines) === "VirtualService");
}

// Collect destination hosts
function collectDestinationHosts(lines) {
  const hosts = [];
  let destinationIndent = -1;

  lines.forEach((line, index) => {
    if (/^\s*destination:\s*$/.test(line)) {
      destinationIndent = line.search(/\S/);
      return;
    }

    if (destinationIndent === -1) return;

    if (line.trim() === "" || /^\s*#/.test(line)) return;

    const indent = line.search(/\S/);

    if (indent <= destinationIndent) {
      destinationIndent = -1;
      return;
    }

    const match = /^\s*host:\s*(\S+)\s*$/.exec(line);

    if (match) {
      hosts.push({
        host: match[1].replace(/^["']|["']$/g, ""),
        line: index + 1
      });

      destinationIndent = -1;
    }
  });

  return hosts;
}

// Convert destination host into service reference
function getServiceReference(host, namespace) {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");

  if (!normalized || normalized === "*") return null;

  const parts = normalized.split(".");

  return {
    name: parts[0],
    namespace: parts[1] || namespace || "default"
  };
}

// Validate VirtualService file
function main() {
  if (!fs.existsSync(CANARY_VS)) {
    throw new Error(`VirtualService file not found: ${CANARY_VS}`);
  }

  const content = fs.readFileSync(CANARY_VS, "utf8");

  const documents = getVirtualServiceDocuments(content);

  if (documents.length !== 1) {
    throw new Error(
      `Expected exactly one VirtualService document, found ${documents.length}`
    );
  }

  const lines = documents[0];

  const namespace =
    getMetadataField(lines, "namespace") || "default";

  const destinations = collectDestinationHosts(lines);

  if (destinations.length === 0) {
    throw new Error("No destination hosts found in VirtualService");
  }

  const services = collectServices(K8S_DIR);
  const missing = [];

  for (const destination of destinations) {
    const reference = getServiceReference(
      destination.host,
      namespace
    );

    if (!reference) continue;

    const key = `${reference.namespace}/${reference.name}`;

    if (!services.has(key)) {
      missing.push(
        `${destination.host} (${path.basename(CANARY_VS)}:${destination.line})`
      );
    }
  }

  if (missing.length > 0) {
    console.error(
      "Canary VirtualService destinations with no matching Kubernetes Service:"
    );

    missing.forEach(item => console.error(` - ${item}`));

    console.error(
      "Add the missing Kubernetes Service or correct the destination host."
    );

    process.exitCode = 1;
    return;
  }

  console.log(
    `All ${destinations.length} canary VirtualService destinations resolve to Services defined in k8s manifests.`
  );
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

