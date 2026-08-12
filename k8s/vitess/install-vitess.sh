#!/bin/bash

echo "🚀 Installing Vitess..."

# Create namespace
kubectl create namespace vitess

# Add Vitess helm repo
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update

# Install Vitess
helm install vitess bitnami/vitess \
  --namespace vitess \
  --set vtctld.enabled=true \
  --set vtgate.enabled=true \
  --set vtworker.enabled=true \
  --set vttablet.replicas=3 \
  --set cells[0].name=zone1 \
  --set cells[0].keyspaces[0].name=main \
  --set cells[0].keyspaces[0].shards=4 \
  --set cells[0].keyspaces[0].tabletsPerShard=2

# Wait for pods
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=vitess -n vitess --timeout=300s

echo "✅ Vitess installed successfully!"