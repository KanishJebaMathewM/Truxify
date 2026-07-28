#!/bin/bash

echo "🚀 Installing KEDA..."

# Add KEDA helm repo
helm repo add kedacore https://kedacore.github.io/charts
helm repo update

# Install KEDA
helm install keda kedacore/keda \
  --namespace keda \
  --create-namespace \
  --set metricsServer.useHostNetwork=true \
  --set operator.useHostNetwork=true

# Wait for pods
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=keda-operator -n keda --timeout=300s
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=keda-operator-metrics-apiserver -n keda --timeout=300s

echo "✅ KEDA installed successfully!"

# Check status
kubectl get pods -n keda