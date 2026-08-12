#!/bin/bash

echo "🚀 Installing Gremlin Chaos Engineering..."

# Create namespace
kubectl create namespace gremlin

# Add Gremlin helm repo
helm repo add gremlin https://helm.gremlin.com
helm repo update

# Install Gremlin
helm install gremlin gremlin/gremlin \
  --namespace gremlin \
  --set gremlin.teamID=${GREMLIN_TEAM_ID} \
  --set gremlin.clusterID=${GREMLIN_CLUSTER_ID} \
  --set gremlin.secret.teamSecret=${GREMLIN_TEAM_SECRET} \
  --set gremlin.kubernetes.clusterName=truxify-cluster

# Wait for pods
kubectl wait --for=condition=ready pod -l app=gremlin -n gremlin --timeout=300s

echo "✅ Gremlin installed successfully!"