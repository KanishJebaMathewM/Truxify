# Argo Rollouts for Truxify

## Installation

### 1. Install Argo Rollouts

./install-argo-rollouts.sh

### 2. Deploy Rollouts

kubectl apply -f rollout.yaml
kubectl apply -f blue-green.yaml
kubectl apply -f ml-analysis.yaml

### 3. Monitor Rollouts

kubectl argo rollouts get rollout api-rollout -n truxify
kubectl argo rollouts dashboard

## Features
 Progressive delivery
 Blue-Green deployments
 Canary analysis
 Automated rollbacks
 ML-based analysis

## Progressive Delivery Strategies
 # Canary Deployment
10% → 25% → 50% → 75% → 100%
Success rate analysis
Auto-promotion

# Blue-Green
Active/Preview services
Manual promotion
Scale down delay

# ML-Based Analysis
Latency monitoring
Error rate tracking
Intelligent decisions

## Commands

# Get rollout status
kubectl argo rollouts get rollout api-rollout -n truxify

# Promote rollout
kubectl argo rollouts promote api-rollout -n truxify

# Abort rollout
kubectl argo rollouts abort api-rollout -n truxify

# Restart rollout
kubectl argo rollouts restart api-rollout -n truxify

# Watch rollout
kubectl argo rollouts watch api-rollout -n truxify

# Dashboard
kubectl argo rollouts dashboard

## Rollback Commands
bash
# Rollback to previous version
kubectl argo rollouts undo api-rollout -n truxify

# Rollback to specific version
kubectl argo rollouts undo api-rollout --to-revision=2 -n truxify