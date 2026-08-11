#!/bin/bash
# Kubernetes deployment script for Truxify API and ML services.
set -e

NAMESPACE="${1:-truxify}"
MANIFESTS_DIR="$(dirname "${BASH_SOURCE[0]}")/../k8s"

echo "[deploy-k8s] Deploying Truxify to namespace '${NAMESPACE}'..."

if [ ! -d "${MANIFESTS_DIR}" ]; then
  echo "[deploy-k8s] Error: k8s manifests directory not found at ${MANIFESTS_DIR}"
  exit 1
fi

kubectl apply -f "${MANIFESTS_DIR}/" --namespace="${NAMESPACE}"
echo "[deploy-k8s] Deployment complete."
