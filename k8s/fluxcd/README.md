# FluxCD GitOps for Truxify

## Installation

### 1. Install FluxCD
```bash
./install-fluxcd.sh
2. Deploy Applications
bash
kubectl apply -f git-repository.yaml
kubectl apply -f helm-repository.yaml
kubectl apply -f progressive-delivery.yaml
3. Check Status
bash
flux get sources git
flux get kustomizations
flux get helmreleases

Features
✅ GitOps with FluxCD
✅ Progressive delivery (Canary)
✅ Multi-tenancy
✅ Image automation
✅ Helm support
✅ Health checks

Progressive Delivery
Canary Deployment
10% → 20% → 30% → 40% → 50%

Success rate analysis

Automatic rollback

Multi-Tenancy
Dev namespace (full access)

Staging namespace (limited access)

Prod namespace (read-only)

Image Automation
Auto-detect new images

Auto-update deployments

Git commit with new tags