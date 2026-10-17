const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const K8S_DIR = path.join(ROOT, "k8s");
const CANARY_VS = path.join(K8S_DIR, "istio", "virtual-service.yaml");

function splitDocs(content) {
  return content
    .split(/^\s*---\s*$/m)
    .map((doc) => doc.trim())
    .filter(Boolean);
}

function getScalar(lines, key) {
  const regex = new RegExp(`^\\s*${key}:\\s*(\\S+)\\s*$`);

  for (const line of lines) {
    const match = regex.exec(line);

    if (match) {
      return match[1].replace(/^["']|["']$/g, "");
    }
  }

  return null;
}

function getMetadataName(lines) {
  let inMetadata = false;

  for (const line of lines) {
    if (/^\s*metadata:\s*$/.test(line)) {
      inMetadata = true;
      continue;
    }

    if (inMetadata) {
      // Leave the metadata block when another top-level field starts.
      if (/^\S/.test(line)) {
        inMetadata = false;
        continue;
      }

      const match = /^\s{2,}name:\s*(\S+)\s*$/.exec(line);

      if (match) {
        return match[1].replace(/^["']|["']$/g, "");
      }
    }
  }

  return null;
}

function getMetadataNamespace(lines) {
  let inMetadata = false;

  for (const line of lines) {
    if (/^\s*metadata:\s*$/.test(line)) {
      inMetadata = true;
      continue;
    }

    if (inMetadata) {
      if (/^\S/.test(line)) {
        inMetadata = false;
        continue;
      }

      const match = /^\s{2,}namespace:\s*(\S+)\s*$/.exec(line);

      if (match) {
        return match[1].replace(/^["']|["']$/g, "");
      }
    }
  }

  return "default";
}

function getKind(lines) {
  return getScalar(lines, "kind");
}

function normalizeHost(host) {
  return host
    .replace(/^["']|["']$/g, "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
}

function getServiceReference(host, virtualServiceNamespace) {
  const normalizedHost = normalizeHost(host);

  if (!normalizedHost || normalizedHost === "*") {
    return null;
  }

  const parts = normalizedHost.split(".");

  /*
   * Kubernetes service references can be:
   *
   * service
   * service.namespace
   * service.namespace.svc
   * service.namespace.svc.cluster.local
   *
   * A fully-qualified service name gives us enough information
   * to validate both service name and namespace.
   */
  const name = parts[0];

  let namespace = virtualServiceNamespace || "default";

  if (parts.length >= 2 && parts[1]) {
    namespace = parts[1];
  }

  return {
    name,
    namespace,
    host: normalizedHost,
  };
}

function collectServices(dir) {
  const services = new Map();

  function walk(currentDir) {
    if (!fs.existsSync(currentDir)) {
      return;
    }

    for (const entry of fs.readdirSync(currentDir, {
      withFileTypes: true,
    })) {
      const filePath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        walk(filePath);
        continue;
      }

      if (!/\.(yaml|yml)$/.test(entry.name)) {
        continue;
      }

      let content;

      try {
        content = fs.readFileSync(filePath, "utf8");
      } catch (error) {
        console.error(`Unable to read ${filePath}: ${error.message}`);
        process.exit(1);
      }

      for (const document of splitDocs(content)) {
        const lines = document.split(/\r?\n/);

        if (getKind(lines) !== "Service") {
          continue;
        }

        const name = getMetadataName(lines);

        if (!name) {
          console.error(
            `Service manifest is missing metadata.name: ${filePath}`,
          );
          process.exit(1);
        }

        const namespace = getMetadataNamespace(lines);

        const key = `${namespace}/${name}`;

        services.set(key, {
          name,
          namespace,
          file: filePath,
        });
      }
    }
  }

  walk(dir);

  return services;
}

function getVirtualServiceDocuments(content) {
  return splitDocs(content)
    .map((document) => document.split(/\r?\n/))
    .filter((lines) => getKind(lines) === "VirtualService");
}

function collectDestinationHosts(lines) {
  const hosts = [];

  let inRouteDestination = false;

  lines.forEach((line, index) => {
    /*
     * We only want destination.host values.
     *
     * This prevents the script from accidentally treating a top-level
     * VirtualService `hosts:` entry as a Kubernetes Service destination.
     */
    if (/^\s*destination:\s*$/.test(line)) {
      inRouteDestination = true;
      return;
    }

    if (inRouteDestination) {
      const match = /^\s*host:\s*(\S+)\s*$/.exec(line);

      if (match) {
        hosts.push({
          host: match[1].replace(/^["']|["']$/g, ""),
          line: index + 1,
        });

        inRouteDestination = false;
        return;
      }

      /*
       * If indentation returns to the same or lower level before
       * finding host, this is not a destination block anymore.
       */
      if (
        line.trim() !== "" &&
        !/^\s{10,}/.test(line)
      ) {
        inRouteDestination = false;
      }
    }
  });

  return hosts;
}

if (!fs.existsSync(CANARY_VS)) {
  console.error(`VirtualService file not found: ${CANARY_VS}`);
  process.exit(1);
}

let vsContent;

try {
  vsContent = fs.readFileSync(CANARY_VS, "utf8");
} catch (error) {
  console.error(
    `Unable to read VirtualService file ${CANARY_VS}: ${error.message}`,
  );
  process.exit(1);
}

const virtualServiceDocs = getVirtualServiceDocuments(vsContent);

if (virtualServiceDocs.length !== 1) {
  console.error(
    `Expected exactly one VirtualService document in ${CANARY_VS}, found ${virtualServiceDocs.length}.`,
  );
  process.exit(1);
}

const virtualServiceLines = virtualServiceDocs[0];

const virtualServiceNamespace =
  getMetadataNamespace(virtualServiceLines);

const destinations = collectDestinationHosts(virtualServiceLines);

if (destinations.length === 0) {
  console.error(
    `No destination hosts found in VirtualService: ${CANARY_VS}`,
  );
  process.exit(1);
}

const services = collectServices(K8S_DIR);

const missing = [];

for (const destination of destinations) {
  const reference = getServiceReference(
    destination.host,
    virtualServiceNamespace,
  );

  if (!reference) {
    continue;
  }

  const key = `${reference.namespace}/${reference.name}`;

  if (!services.has(key)) {
    missing.push(
      `${destination.host} (${virtualServiceLines ? "virtual-service.yaml" : CANARY_VS}:${destination.line})`,
    );
  }
}

if (missing.length > 0) {
  console.error(
    "Canary VirtualService destinations with no matching Kubernetes Service:",
  );

  for (const destination of missing) {
    console.error(`  - ${destination}`);
  }

  console.error(
    "Add the missing Service with the correct namespace/selector or remove/redirect the destination.",
  );

  process.exit(1);
}

console.log(
  `All ${destinations.length} canary VirtualService destinations resolve to Services defined in k8s manifests.`,
);
