#!/bin/bash

echo "🚀 Installing FluxCD..."

# Install Flux CLI
curl -s https://fluxcd.io/install.sh | sudo bash

# Bootstrap Flux
flux bootstrap git \
  --url=https://github.com/BhakktiGautam/Truxify \
  --branch=main \
  --path=./k8s/fluxcd \
  --namespace=flux-system

# Wait for Flux to be ready
kubectl wait --for=condition=ready pod -l app.fluxcd.io/part-of=flux -n flux-system --timeout=300s

echo "✅ FluxCD installed successfully!"