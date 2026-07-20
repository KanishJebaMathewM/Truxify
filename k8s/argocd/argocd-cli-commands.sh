#!/bin/bash

echo "🔧 ArgoCD CLI Commands"

# Login to ArgoCD
argocd login localhost:8080

# Create application
argocd app create truxify \
  --repo https://github.com/BhakktiGautam/Truxify \
  --path k8s \
  --dest-server https://kubernetes.default.svc \
  --dest-namespace truxify \
  --sync-policy automated

# Sync application
argocd app sync truxify

# Get application status
argocd app get truxify

# Rollback to previous version
argocd app rollback truxify 1

# Set image auto-update
argocd app set truxify --auto-prune --self-heal

# Watch application
argocd app watch truxify

# List applications
argocd app list

# Delete application
argocd app delete truxify

# Sync with force
argocd app sync truxify --force

# Get application history
argocd app history truxify