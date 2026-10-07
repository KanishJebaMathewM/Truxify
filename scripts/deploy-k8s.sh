#!/usr/bin/env bash
set -euo pipefail

# Deploy the core Truxify Kubernetes manifests in dependency order:
# namespace -> configmap/secrets -> storage -> deployments -> services -> HPA.
#
# Optional layers (istio, linkerd, keda, ...) require CRDs that are installed
# by their respective operators, so they are only applied when explicitly
# enabled via their *_ENABLED environment variable (e.g. ISTIO_ENABLED=1).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="${SCRIPT_DIR}/../k8s"
KUBECTL_BIN="${KUBECTL:-kubectl}"

command -v "${KUBECTL_BIN}" >/dev/null 2>&1 || {
  echo "kubectl not found. Install it or set KUBECTL to the binary path." >&2
  exit 1
}

# ---------------------------------------------------------------------------
# Secret handling (issue #10793)
#
# Secrets must NEVER be applied from a committed, plaintext manifest. A
# placeholder value committed to a public repo lets anyone who can read the
# repo forge JWTs or access the database after a deploy.
#
# This script refuses to run unless a real secret source is configured and
# the cluster secret already exists. Secret material is expected to come from
# a secret manager (Vault / SOPS / SealedSecrets / external-secrets) or from
# CI-injected values, e.g.:
#
#   sops -d "${K8S_DIR}/secrets.enc.yaml" | kubectl apply -f -
#   kubectl create secret generic truxify-secrets \
#     --from-literal=JWT_SECRET="${JWT_SECRET}" \
#     --from-literal=DB_PASSWORD="${DB_PASSWORD}" ...
# ---------------------------------------------------------------------------

SECRET_NAME="truxify-secrets"
SECRET_SOURCE_VARS=("K8S_VAULT_ROLE" "SECRETS_ENC_KEY")
HAS_SECRET_SOURCE=0
for var in "${SECRET_SOURCE_VARS[@]}"; do
  if [ -n "${!var:-}" ]; then
    HAS_SECRET_SOURCE=1
    break
  fi
done

if [ "${HAS_SECRET_SOURCE}" = "0" ]; then
  echo "Refusing to deploy: no secret source configured." >&2
  echo "Set K8S_VAULT_ROLE (Vault) or SECRETS_ENC_KEY (SOPS) and make the" >&2
  echo "secret material available through a secret manager." >&2
  exit 1
fi

if [ -f "${K8S_DIR}/secrets.yaml" ]; then
  echo "Refusing to deploy: ${K8S_DIR}/secrets.yaml is a committed plaintext" >&2
  echo "manifest. Delete it and manage the '${SECRET_NAME}' secret via Vault," >&2
  echo "SOPS/SealedSecrets, or CI-injected 'kubectl create secret'." >&2
  exit 1
fi

assert_real_secret() {
  local value
  if ! "${KUBECTL_BIN}" get secret "${SECRET_NAME}" >/dev/null 2>&1; then
    echo "Refusing to deploy: secret '${SECRET_NAME}' is not present." >&2
    echo "Create it from the configured secret manager before deploying workloads." >&2
    exit 1
  fi

  value="$("${KUBECTL_BIN}" get secret "${SECRET_NAME}" -o jsonpath='{.data.JWT_SECRET}' 2>/dev/null || true)"
  if [ -n "${value}" ] && [ "$(printf '%s' "${value}" | base64 -d 2>/dev/null || true)" = "truxify-dev-secret-placeholder" ]; then
    echo "Refusing to deploy: secret '${SECRET_NAME}' still holds the public" >&2
    echo "placeholder JWT_SECRET value." >&2
    exit 1
  fi
}

apply() {
  local manifest="$1"
  echo "==> Applying ${manifest}"
  "${KUBECTL_BIN}" apply -f "${manifest}"
}

# 1. Namespace first so every downstream resource has a home.
apply "${K8S_DIR}/namspace.yaml"

# 2. ConfigMap. Secrets are provisioned out-of-band via a secret manager.
apply "${K8S_DIR}/configmap.yaml"

# 3. Storage.
apply "${K8S_DIR}/pvcs/storage-pvcs.yaml"

# 4. Ensure real secret material exists before anything that consumes it.
assert_real_secret

# 5. Deployments.
for manifest in "${K8S_DIR}"/deployments/*.yaml; do
  apply "${manifest}"
done

# 6. Services.
for manifest in "${K8S_DIR}"/services/*.yaml; do
  apply "${manifest}"
done

# 7. HorizontalPodAutoscalers.
for manifest in "${K8S_DIR}"/hpa/*.yaml; do
  apply "${manifest}"
done

# 8. Optional service-mesh layer (requires the Istio operator + CRDs).
if [ "${ISTIO_ENABLED:-0}" = "1" ]; then
  for manifest in "${K8S_DIR}"/istio/*.yaml; do
    apply "${manifest}"
  done
  if [ -d "${K8S_DIR}/istio/monitoring" ]; then
    for manifest in "${K8S_DIR}"/istio/monitoring/*.yaml; do
      apply "${manifest}"
    done
  fi
fi

echo "==> Deployment complete. Check status with: kubectl get pods -n truxify"
