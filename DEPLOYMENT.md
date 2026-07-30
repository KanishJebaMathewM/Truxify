# Truxify Open Source Deployment Guide

Welcome to the official Truxify deployment guide! This document is designed for NGOs, state governments, and open-source contributors looking to self-host the Truxify logistics platform in a production environment. 

This guide covers deploying the backend services (Node.js API, matching worker) using modern orchestration tools like **Docker Swarm** or **Kubernetes (K8s)**, alongside essential security practices using **Cloudflare**.

---

## Architecture Overview

A typical production deployment of Truxify consists of:
1. **API Service:** The core Node.js/Express backend (`backend/api`).
2. **PostgreSQL / Supabase:** The primary relational database.
3. **Redis:** In-memory caching, message broker, and rate limiting.
4. **Blockchain RPC:** Connection to Polygon (Mainnet or Mumbai testnet) via Alchemy/Infura for the Escrow smart contracts.

---

## 1. Environment Variables & Secrets Management

Securely managing your secrets is critical. Never hardcode passwords or API keys in your deployment files.

### Required Secrets
Ensure you have the following secrets ready before deployment:
* `DATABASE_URL` (PostgreSQL connection string)
* `REDIS_URL`
* `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
* `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (or the `serviceAccountKey.json`)
* `BLOCKCHAIN_RPC_URL` and `ESCROW_PRIVATE_KEY` (For the relayer wallet)
* `VALID_API_KEYS` (Comma separated list for zero-downtime rotation)
* `SENTRY_DSN` (For error tracking)

### Storing Secrets
* **Docker Swarm:** Use Docker Secrets.
  ```bash
  echo "your-database-url" | docker secret create db_url -
  ```
* **Kubernetes:** Use Kubernetes Secrets or a tool like HashiCorp Vault / External Secrets Operator.
  ```bash
  kubectl create secret generic truxify-secrets \
    --from-literal=DATABASE_URL="your-database-url" \
    --from-literal=REDIS_URL="your-redis-url"
  ```

---

## 2. Option A: Docker Swarm Deployment

Docker Swarm is excellent for simple, multi-node deployments without the overhead of Kubernetes.

### `docker-compose.prod.yml`

Create a production compose file to deploy as a stack:

```yaml
version: '3.8'

services:
  truxify-api:
    image: truxify/api:latest
    deploy:
      replicas: 3
      update_config:
        parallelism: 1
        delay: 10s
        order: start-first
      restart_policy:
        condition: on-failure
    environment:
      - NODE_ENV=production
      - PORT=5000
    secrets:
      - db_url
      - redis_url
    networks:
      - truxify-net

networks:
  truxify-net:
    driver: overlay

secrets:
  db_url:
    external: true
  redis_url:
    external: true
```

### Deploying the Stack
Run the following command on your Swarm manager node:
```bash
docker stack deploy -c docker-compose.prod.yml truxify_stack
```

---

## 3. Option B: Kubernetes (K8s) Deployment

For massive scale, high availability, and self-healing, Kubernetes is the recommended orchestration engine.

### `deployment.yaml`

Below is a basic Deployment and Service configuration for the Truxify API:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: truxify-api
  labels:
    app: truxify-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: truxify-api
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: truxify-api
    spec:
      containers:
      - name: truxify-api
        image: truxify/api:latest
        ports:
        - containerPort: 5000
        env:
        - name: NODE_ENV
          value: "production"
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: truxify-secrets
              key: DATABASE_URL
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: truxify-secrets
              key: REDIS_URL
        resources:
          limits:
            memory: "512Mi"
            cpu: "500m"
          requests:
            memory: "256Mi"
            cpu: "250m"
        livenessProbe:
          httpGet:
            path: /health
            port: 5000
          initialDelaySeconds: 15
          periodSeconds: 20
---
apiVersion: v1
kind: Service
metadata:
  name: truxify-api-svc
spec:
  selector:
    app: truxify-api
  ports:
    - protocol: TCP
      port: 80
      targetPort: 5000
  type: ClusterIP
```

### Deploying to the Cluster
Apply the configuration using `kubectl`:
```bash
kubectl apply -f deployment.yaml
```

---

## 4. Edge Security & Routing with Cloudflare

For DDoS protection, SSL/TLS termination, and edge caching, we strongly recommend placing **Cloudflare** in front of your Truxify infrastructure.

### Setting up Cloudflare for the API
1. **Proxy Enabled (Orange Cloud):** In your Cloudflare DNS settings, create an `A` or `CNAME` record pointing to your Swarm/K8s Load Balancer IP and ensure the "Proxy status" is toggled ON.
2. **Strict SSL/TLS:** Go to SSL/TLS -> Overview, and set encryption to **Full (Strict)**. Ensure your load balancer has a valid origin certificate.
3. **Web Application Firewall (WAF):** Set up custom WAF rules to challenge or block requests originating from outside your target geographic region (e.g., block non-India IPs if deploying exclusively for an Indian state government).
4. **Page Rules:** 
   * Bypass caching for API routes (`api.yourdomain.com/*`).
   * Enforce aggressive caching for static assets (if hosting the web dashboard).
5. **Rate Limiting:** While Truxify has built-in Express rate limiting, configuring Cloudflare Rate Limiting adds an essential outer layer of defense against volumetric attacks.

## 5. Mobile Apps Deployment
To deploy the Flutter apps (`apps/driver` and `apps/customer`):
1. Update `lib/config/env.dart` or `.env` files to point to your new Cloudflare API domain.
2. Build the release APKs/AABs for Android:
   ```bash
   flutter build apk --release
   flutter build appbundle --release
   ```
3. Distribute internally via MDM (Mobile Device Management) or publish to the Google Play Store/Apple App Store under your organization's developer account.
