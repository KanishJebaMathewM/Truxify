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

apply() {
  local manifest="$1"
  echo "==> Applying ${manifest}"
  "${KUBECTL_BIN}" apply -f "${manifest}"
}

# 1. Namespace first so every downstream resource has a home.
apply "${K8S_DIR}/namspace.yaml"

# 2. ConfigMap and Secrets.
apply "${K8S_DIR}/configmap.yaml"
apply "${K8S_DIR}/secrets.yaml"

# 3. Storage.
apply "${K8S_DIR}/pvcs/storage-pvcs.yaml"

# 3.5. Prerequisite service accounts / RBAC.
# These must exist before the deployments that reference them are created,
# otherwise the API pods get stuck in FailedCreate.
if [ -d "${K8S_DIR}/authorization" ]; then
  for manifest in "${K8S_DIR}"/authorization/*.yaml; do
    apply "${manifest}"
  done
fi

# 4. Deployments.
for manifest in "${K8S_DIR}"/deployements/*.yaml; do
  apply "${manifest}"
done

# 5. Services.
for manifest in "${K8S_DIR}"/services/*.yaml; do
  apply "${manifest}"
done

# 6. HorizontalPodAutoscalers.
for manifest in "${K8S_DIR}"/hpa/*.yaml; do
  apply "${manifest}"
done

# 7. Optional service-mesh layer (requires the Istio operator + CRDs).
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

# 8. Post-deploy sanity check: fail fast if a referenced service account is missing.
if ! "${KUBECTL_BIN}" get serviceaccount api-service-account -n truxify >/dev/null 2>&1; then
  echo "ERROR: api-service-account service account is missing in namespace truxify." >&2
  echo "The api-deployment references it and its pods will fail to start." >&2
  exit 1
fi

echo "==> Deployment complete. Check status with: kubectl get pods -n truxify"
