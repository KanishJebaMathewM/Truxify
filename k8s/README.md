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
# Deploy using kubectl directly:
kubectl apply -f api-deployment.yaml
kubectl apply -f ml-deployment.yaml
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
## Network isolation

Apply `k8s/network-policies/truxify-ingress.yaml` with the workloads after confirming that the cluster CNI enforces Kubernetes NetworkPolicy:

```bash
kubectl apply -f k8s/network-policies/truxify-ingress.yaml
kubectl get networkpolicy -n truxify
kubectl describe networkpolicy -n truxify
```

The policy denies ingress to every pod in the `truxify` namespace by default. It then permits traffic to API pods on TCP 5000 from all sources (the public entry point), and permits traffic to Redis on 6379, Postgres shards on 5432, and ML on 8000 only from API pods in this namespace. It covers the Deployment labels and the optional Argo Rollout labels. Other workloads added to this namespace need an explicit ingress rule before deployment.

Egress remains unrestricted because the API uses external payment, notification, and telemetry endpoints; restricting it requires an inventory of those destinations. If a service mesh redirects inbound connections to a proxy port, add that port to the appropriate allow policy before applying it. A CNI without NetworkPolicy enforcement will accept these resources without enforcing isolation.
