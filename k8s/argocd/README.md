# ArgoCD GitOps for Truxify

## Installation

### 1. Install ArgoCD
```bash
./install-argocd.sh

2. Deploy Applications
bash
kubectl apply -f argocd-application.yaml
kubectl apply -f progressive-delivery.yaml
kubectl apply -f applicationset.yaml

3. Access ArgoCD UI
bash
kubectl port-forward svc/argocd-server -n argocd 8080:443
# Username: admin
# Password: from install script