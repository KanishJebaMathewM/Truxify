#!/bin/bash

echo "🚀 Installing Linkerd..."

# Install Linkerd CLI
curl -sL https://run.linkerd.io/install | sh
export PATH=$PATH:$HOME/.linkerd2/bin

# Verify installation
linkerd version

# Install Linkerd control plane
linkerd install --crds | kubectl apply -f -
linkerd install | kubectl apply -f -

# Wait for pods
kubectl wait --for=condition=ready pod -l linkerd.io/control-plane-component -n linkerd --timeout=300s

# Verify installation
linkerd check

# Enable automatic proxy injection
kubectl annotate namespace truxify linkerd.io/inject=enabled

echo "✅ Linkerd installed successfully!"

# Get dashboard URL
linkerd dashboard &