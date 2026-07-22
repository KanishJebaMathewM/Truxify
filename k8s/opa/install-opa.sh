#!/bin/bash

echo "🚀 Installing OPA (Open Policy Agent)..."

# Install OPA
curl -L -o opa https://openpolicyagent.org/downloads/latest/opa_linux_amd64_static
chmod +x opa
sudo mv opa /usr/local/bin/

# Install OPA Gatekeeper
kubectl apply -f https://raw.githubusercontent.com/open-policy-agent/gatekeeper/release-3.12/deploy/gatekeeper.yaml

# Wait for pods
kubectl wait --for=condition=ready pod -l gatekeeper.sh/operation=webhook -n gatekeeper-system --timeout=300s

echo "✅ OPA installed successfully!"