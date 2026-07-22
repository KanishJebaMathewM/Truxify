#!/bin/bash

echo "🚀 Installing ArgoCD..."

# Create namespace
kubectl create namespace argocd

# Install ArgoCD
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# Wait for pods
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=argocd-server -n argocd --timeout=300s

# Get initial password
echo "📝 Initial Admin Password:"
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d

# Port forward
echo "🔗 Access ArgoCD UI: http://localhost:8080"
kubectl port-forward svc/argocd-server -n argocd 8080:443 &

echo "✅ ArgoCD installed successfully!"