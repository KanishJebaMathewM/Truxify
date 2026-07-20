#!/bin/bash

echo "🚀 Installing Consul Service Mesh..."

# Create namespace
kubectl create namespace consul

# Add HashiCorp helm repo
helm repo add hashicorp https://helm.releases.hashicorp.com
helm repo update

# Install Consul
helm install consul hashicorp/consul \
  --namespace consul \
  --set global.name=consul \
  --set global.datacenter=dc1 \
  --set global.tls.enabled=true \
  --set global.tls.httpsOnly=true \
  --set connectInject.enabled=true \
  --set connectInject.defaultEnabled=true \
  --set meshGateway.enabled=true \
  --set meshGateway.replicas=2 \
  --set server.replicas=3 \
  --set server.storage=10Gi \
  --set client.enabled=true \
  --set client.grpc=true \
  --set ui.enabled=true \
  --set ui.service.type=LoadBalancer

# Wait for pods
kubectl wait --for=condition=ready pod -l app=consul -n consul --timeout=300s

echo "✅ Consul installed successfully!"

# Get Consul UI URL
kubectl get svc consul-ui -n consul

# Port forward for UI
echo "🔗 Access Consul UI: http://localhost:8500"
kubectl port-forward svc/consul-ui -n consul 8500:80 &