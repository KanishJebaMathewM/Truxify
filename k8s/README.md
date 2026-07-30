# Truxify Kubernetes Deployment

## Prerequisites
- Kubernetes cluster (EKS/AKS/GKE/minikube)
- kubectl installed
- Docker images built and pushed to registry

## Quick Start

### 1. Build and Push Images
```bash
docker build -t truxify/api:latest -f Dockerfile.api .
docker build -t truxify/ml:latest -f Dockerfile.ml .
docker push truxify/api:latest
docker push truxify/ml:latest

2. Deploy to Kubernetes
bash
chmod +x scripts/deploy-k8s.sh
./scripts/deploy-k8s.sh
3. Check Status
bash
kubectl get pods -n truxify
kubectl get hpa -n truxify
kubectl get services -n truxify
4. Access API
bash
kubectl port-forward -n truxify svc/api-service 8080:80
curl http://localhost:8080/api/health
Auto-Scaling Configuration
Horizontal Pod Autoscaler (HPA)
API: 3-20 replicas (CPU 70%, Memory 80%)

ML Engine: 2-10 replicas (CPU 70%, Memory 80%)

Shards: 1-3 replicas (CPU 70%, Memory 80%)

Scale Down Behavior
Stabilization window: 300 seconds

Max 50% reduction per minute

Min 2 pods removed

Scale Up Behavior
Stabilization window: 60 seconds

Max 100% increase per 30 seconds

Max 4 pods added per 30 seconds

Monitoring
bash
# Watch HPA status
kubectl get hpa -n truxify -w

# Watch pods
kubectl get pods -n truxify -w

# Get metrics
kubectl top pods -n truxify
Troubleshooting
bash
# Check pod logs
kubectl logs -n truxify deployment/api-deployment

# Describe pod
kubectl describe pod -n truxify <pod-name>

# Check events
kubectl get events -n truxify